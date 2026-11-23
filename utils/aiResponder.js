import "dotenv/config";
import getUserName from "../helper/getUserName.js";
import splitMessage from "../helper/splitMessage.js";
import { createRequestId, logAiEvent } from "./ai/observability.js";
import { sendOperationsAlert } from "./ai/discordAlert.js";
import { createAiProviderService } from "./ai/providers.js";
import { createConversation } from "./conversation/conversation.js";
import { createFileStore } from "./conversation/fileStore.js";

const providerService = createAiProviderService({
  logEvent: logAiEvent,
  alert: sendOperationsAlert,
});
const conversation = createConversation({
  store: createFileStore(),
  generate: (request) => providerService.generate(request),
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
