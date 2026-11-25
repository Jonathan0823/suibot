import "dotenv/config";
import getUserName from "../helper/getUserName.js";
import splitMessage from "../src/utils/splitMessage.js";
import { createRequestId, logAiEvent } from "../src/modules/ai/observability.js";
import { sendOperationsAlert } from "../src/modules/ai/discordAlert.js";
import { createAiProviderService } from "../src/modules/ai/providers.js";
import { createToolLoop } from "../src/modules/ai/toolLoop.js";
import { createTools } from "../src/modules/ai/tools.js";
import { ensureScrapedCodeCache, getCachedCodesForGame } from "./codeScraper.js";
import { getEnkaService } from "../src/modules/enka/enkaClient.js";
import { createConversation } from "../src/modules/conversation/conversation.js";
import { createPostgresStore } from "../src/modules/conversation/postgresStore.js";
import prisma from "../src/lib/prisma.js";

const providerService = createAiProviderService({
  logEvent: logAiEvent,
  alert: sendOperationsAlert,
});
const generateWithTools = createToolLoop({
  generate: (request) => providerService.generate(request),
  logEvent: logAiEvent,
  tools: createTools({
    search: (query) => providerService.search(query),
    getCodes: async (game) => {
      await ensureScrapedCodeCache();
      return getCachedCodesForGame(game);
    },
    getPlayer: (game, uid) => getEnkaService().getPlayer(game, uid),
  }),
});
const tokenBudget = Number(process.env.CONVERSATION_TOKEN_BUDGET);
const conversation = createConversation({
  store: createPostgresStore({ prisma }),
  generate: generateWithTools,
  logEvent: logAiEvent,
  ...(tokenBudget > 0 ? { tokenBudget } : {}),
});

async function aiResponder(message, args, systemInstruction, commandName) {
  const requestId = createRequestId();

  try {
    const result = await conversation.respond({
      scope: {
        guildId: message.guildId,
        channelId: message.channelId,
        userId: message.author?.id || "unknown",
        commandName,
      },
      speaker: getUserName(message),
      text: args.join(" "),
      persona: systemInstruction,
      context: {
        requestId,
        commandName,
      },
    });

    if (result.kind === "reset") {
      await message.channel.send("Chat history has been reset.");
      return;
    }

    for (const part of splitMessage(result.text)) {
      await message.channel.send(part);
    }
  } catch (error) {
    logAiEvent("ai_generation_failed", {
      requestId,
      commandName,
      errorType: error?.name || "unknown",
      attempts: error?.attempts?.length || 0,
    });
    await message.channel.send("Sorry, something went wrong with the AI generation.");
  }
}

export default aiResponder;
