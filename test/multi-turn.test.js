/**
 * Multi-turn conversation integration test
 * Tests memory persistence across turns
 */

import { describe, it, expect } from "vitest";
import { createMemoryKey } from "../utils/memory/memoryKey.js";
import { createRecentMemory } from "../utils/memory/recentMemory.js";
import { createSummaryMemory } from "../utils/memory/summaryMemory.js";
import { createMemoryManager } from "../utils/memory/memoryManager.js";

describe("Multi-turn conversation integration", () => {
  it("persists context across turns and extracts facts", () => {
    const recentMemory = createRecentMemory(10);
    const summaryMemory = createSummaryMemory({ turnsThreshold: 3 });
    const memoryManager = createMemoryManager({ ttlHours: 24 });

    const memoryKey = createMemoryKey({
      guildId: "guild1",
      channelId: "channel1",
      userId: "user1",
      commandName: "yukinon",
    });

    recentMemory.add(memoryKey, { sender: "user1", content: "Hello" });
    memoryManager.touch(memoryKey);

    recentMemory.add(memoryKey, { sender: "user1", content: "What's my name?" });
    memoryManager.touch(memoryKey);

    recentMemory.add(memoryKey, { sender: "user1", content: "My name is Alice" });
    memoryManager.touch(memoryKey);

    const facts = memoryManager.extractFacts("My name is Alice");

    recentMemory.add(memoryKey, { sender: "user1", content: "What's my name?" });
    const finalTurns = recentMemory.get(memoryKey);

    expect(finalTurns).toHaveLength(4);
    expect(finalTurns.some((t) => t.content.includes("Alice"))).toBe(true);
    expect(facts).toHaveLength(1);
    expect(memoryManager.shouldSaveFacts("My name is Alice")).toBe(true);
    expect(summaryMemory.shouldSummarize(memoryKey, finalTurns)).toBe(true);
  });
});
