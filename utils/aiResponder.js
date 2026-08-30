import "dotenv/config";
import getUserName from "../helper/getUserName.js";
import { titleCase } from "../helper/titleCase.js";
import splitMessage from "../helper/splitMessage.js";
import { createMemoryKey } from "./memory/memoryKey.js";
import { createRecentMemory } from "./memory/recentMemory.js";
import { createSummaryMemory } from "./memory/summaryMemory.js";
import { getCachedPrompt, setCachedPrompt } from "./memory/promptCache.js";
import { createPromptBuilder } from "./prompt/builder.js";
import { createMemoryManager } from "./memory/memoryManager.js";
import { createFileStorage } from "./memory/storage.js";
import { createAiProviderService } from "./ai/providers.js";
import {
  createRequestId,
  logAiEvent,
  notifyAiFailure,
} from "./ai/observability.js";

// Initialize memory layers
const recentMemory = createRecentMemory(10);
const summaryMemory = createSummaryMemory({ turnsThreshold: 10 });
const promptBuilder = createPromptBuilder();
const memoryManager = createMemoryManager({ ttlHours: 24 });
const fileStorage = createFileStorage();
const providerService = createAiProviderService({ logEvent: logAiEvent });

async function aiResponder(message, args, systemInstruction, commandName) {
  const requestId = createRequestId();
  const user = getUserName(message);
  const userId = message.author?.id || "unknown";
  const channelId = message.channelId;
  const guildId = message.guildId;

  // Use scoped memory key: guildId + channelId + userId + commandName
  const memoryKey = createMemoryKey({
    guildId,
    channelId,
    userId,
    commandName,
  });

  try {
    const isNotEmpty = args.length > 0;
    const prompt = isNotEmpty
      ? args.join(" ")
      : `Halo, ${titleCase(commandName)}!`;

    const isReset = prompt.toLowerCase() === "reset";

    // Check memory management rules
    const { shouldClear } = memoryManager.shouldClearMemory({
      args: isNotEmpty ? [prompt] : [],
      isReset,
      hasMemory: recentMemory.has(memoryKey),
    });

    if (shouldClear) {
      recentMemory.clear(memoryKey);
      summaryMemory.clear(memoryKey);
      fileStorage.delete(memoryKey);
      await message.channel.send("Chat history has been reset.");
      return;
    }

    // Touch memory to track last access
    memoryManager.touch(memoryKey);

    // Cleanup stale memories periodically (5% chance)
    if (Math.random() < 0.05) {
      memoryManager.cleanupStale((key) => {
        recentMemory.clear(key);
        summaryMemory.clear(key);
        fileStorage.delete(key);
      });
    }

    // Get cached prompt or use provided
    let cachedSystemInstruction = getCachedPrompt(commandName);
    if (!cachedSystemInstruction) {
      cachedSystemInstruction = systemInstruction;
      setCachedPrompt(commandName, cachedSystemInstruction);
    }

    // Load persisted memory if not in cache
    if (!recentMemory.has(memoryKey)) {
      const persisted = fileStorage.get(memoryKey);
      if (persisted) {
        recentMemory.set(memoryKey, persisted.recent || []);
        summaryMemory.set(
          memoryKey,
          persisted.summary || { turns: [], summary: "" },
        );
      }
    }

    // Build context from memory layers
    const recentTurns = recentMemory.get(memoryKey);
    const { summary } = summaryMemory.get(memoryKey);

    // Build prompt using prompt builder
    const { contents, config: promptConfig } = promptBuilder.build({
      systemInstruction: cachedSystemInstruction,
      recentTurns,
      summary,
      currentMessage: prompt,
      user,
    });

    const aiResponse = await providerService.generate({
      requestId,
      commandName,
      contents,
      systemInstruction: promptConfig.systemInstruction,
      notifyFailure: (details) => notifyAiFailure({
        client: message.client,
        commandName,
        ...details,
      }),
    });

    const responseParts = splitMessage(aiResponse);

    for (const part of responseParts) {
      await message.channel.send(part);
    }

    // Update memory layers
    recentMemory.add(memoryKey, { sender: user, content: prompt });
    recentMemory.add(memoryKey, { sender: commandName, content: aiResponse });

    // Check if we need to generate summary
    if (summaryMemory.shouldSummarize(memoryKey, recentTurns)) {
      const newSummary = summaryMemory.generateSummary(recentTurns);
      summaryMemory.set(memoryKey, { turns: recentTurns, summary: newSummary });
    }

    // Auto-save facts to persistent layer
    if (memoryManager.shouldSaveFacts(prompt)) {
      const facts = memoryManager.extractFacts(prompt);
      for (const fact of facts) {
        // Store in file storage
        const factKey = `${memoryKey}:fact:${fact.key}`;
        fileStorage.set(factKey, fact.value);
      }
    }

    // Persist memory to file storage
    fileStorage.set(memoryKey, {
      recent: recentTurns,
      summary: summaryMemory.get(memoryKey),
      lastSaved: Date.now(),
    });
  } catch (error) {
    logAiEvent("ai_generation_failed", {
      requestId,
      commandName,
      errorType: error?.name || "unknown",
      attempts: error?.attempts?.length || 0,
    });
    await message.channel.send(
      "Sorry, something went wrong with the AI generation.",
    );
  }
}

export default aiResponder;
