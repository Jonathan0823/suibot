import "dotenv/config";
import { createRequestId, logAiEvent } from "../ai/observability.js";
import { createConversation } from "../conversation/conversation.js";
import splitMessage from "../../utils/splitMessage.js";
import getUserName from "./getUserName.js";

/**
 * Persona responder: turns a Discord message into a Conversation Turn and sends the split reply.
 * Everything is injected; nothing is constructed at import time.
 * @param {object} deps
 * @param {object} [deps.conversation] a Conversation (respond/reset); built from store + generate when absent
 * @param {object} [deps.store] conversation store (defaults to the Postgres store over prisma)
 * @param {Function} [deps.generate] provider generate() (defaults to the provider service + tool loop)
 * @param {object} [deps.prisma] used for the default Postgres store
 * @param {object} [deps.providers] provider service ({ generate, search }) for the default generate
 * @param {object} [deps.tools] tools for the default tool loop
 * @param {Function} [deps.logEvent] structured event logger
 * @param {number} [deps.tokenBudget] Conversation token budget
 */
export function createPersonaResponder({
  conversation,
  store,
  generate,
  prisma,
  providers,
  tools,
  logEvent = logAiEvent,
  tokenBudget,
  getUserName: resolveName = getUserName,
  createRequestId: newRequestId = createRequestId,
} = {}) {
  let built = conversation ?? null;
  let building = null;

  async function build() {
    const [
      { createToolLoop },
      { createTools },
      { createAiProviderService },
      { sendOperationsAlert },
    ] =
      generate && store
        ? [{}, {}, {}, {}]
        : await Promise.all([
            import("../ai/toolLoop.js"),
            import("../ai/tools.js"),
            import("../ai/providers.js"),
            import("../ai/discordAlert.js"),
          ]);
    let gen = generate;
    if (!gen) {
      const service =
        providers ?? createAiProviderService({ logEvent, alert: sendOperationsAlert });
      gen = createToolLoop({
        generate: (request) => service.generate(request),
        logEvent,
        tools: tools ?? createTools({ search: (query) => service.search(query) }),
      });
    }
    let convStore = store;
    if (!convStore) {
      const { createPostgresStore } = await import("../conversation/postgresStore.js");
      convStore = createPostgresStore({
        prisma: prisma ?? (await import("../../lib/prisma.js")).default,
      });
    }
    return createConversation({
      store: convStore,
      generate: gen,
      logEvent,
      ...(tokenBudget > 0 ? { tokenBudget } : {}),
    });
  }

  async function getConversation() {
    if (built) return built;
    building ??= build().then((c) => {
      built = c;
      return c;
    });
    return building;
  }

  async function reply(message, persona, args) {
    const requestId = newRequestId();
    const commandName = persona.personaId;

    try {
      const result = await (await getConversation()).respond({
        scope: {
          guildId: message.guildId,
          channelId: message.channelId,
          userId: message.author?.id || "unknown",
          commandName,
        },
        speaker: resolveName(message),
        text: args.join(" "),
        persona: persona.instruction,
        context: { requestId, commandName },
      });

      if (result.kind === "reset") {
        await message.channel.send("Chat history has been reset.");
        return;
      }

      for (const part of splitMessage(result.text)) {
        await message.channel.send(part);
      }
    } catch (error) {
      logEvent("ai_generation_failed", {
        requestId,
        commandName,
        errorType: error?.name || "unknown",
        attempts: error?.attempts?.length || 0,
      });
      await message.channel.send("Sorry, something went wrong with the AI generation.");
    }
  }

  return { reply };
}

/** Production composition: provider service, tool loop, tools, Postgres Conversation, alerts. */
export async function createDefaultPersonaResponder() {
  const [
    { default: prisma },
    { default: redeemCodes },
    { getEnkaService },
    { createAiProviderService },
    { sendOperationsAlert },
  ] = await Promise.all([
    import("../../lib/prisma.js"),
    import("../redeemCodes/index.js"),
    import("../enka/enkaClient.js"),
    import("../ai/providers.js"),
    import("../ai/discordAlert.js"),
  ]);
  const { createTools } = await import("../ai/tools.js");
  const providers = createAiProviderService({ logEvent: logAiEvent, alert: sendOperationsAlert });
  return createPersonaResponder({
    prisma,
    providers,
    tools: createTools({
      search: (query) => providers.search(query),
      getCodes: (game) => redeemCodes.getActiveCodes(game),
      getPlayer: (game, uid) => getEnkaService().getPlayer(game, uid),
    }),
    tokenBudget: Number(process.env.CONVERSATION_TOKEN_BUDGET),
  });
}
