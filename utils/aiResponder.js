import "dotenv/config";
import getUserName from "../helper/getUserName.js";
import splitMessage from "../helper/splitMessage.js";
import { createRequestId, logAiEvent } from "./ai/observability.js";
import { sendOperationsAlert } from "./ai/discordAlert.js";
import { createAiProviderService } from "./ai/providers.js";
import { createToolLoop } from "./ai/toolLoop.js";
import { createTools } from "./ai/tools.js";
import { ensureScrapedCodeCache, getCachedCodesForGame } from "./codeScraper.js";
import { Wrapper } from "enkanetwork.js";
import { createConversation } from "./conversation/conversation.js";
import { createPostgresStore } from "./conversation/postgresStore.js";
import prisma from "../lib/prisma.js";

const providerService = createAiProviderService({
  logEvent: logAiEvent,
  alert: sendOperationsAlert,
});
const enka = new Wrapper({ cache: true });
const generateWithTools = createToolLoop({
  generate: (request) => providerService.generate(request),
  logEvent: logAiEvent,
  tools: createTools({
    search: (query) => providerService.search(query),
    getCodes: async (game) => {
      await ensureScrapedCodeCache();
      return getCachedCodesForGame(game);
    },
    getPlayer: (game, uid) => enka[game].getPlayer(uid),
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
