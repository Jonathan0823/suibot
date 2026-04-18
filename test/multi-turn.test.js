/**
 * Multi-turn conversation integration test
 * Tests memory persistence across turns
 */

import { createMemoryKey } from "../utils/memory/memoryKey.js";
import { createRecentMemory } from "../utils/memory/recentMemory.js";
import { createSummaryMemory } from "../utils/memory/summaryMemory.js";
import { createMemoryManager } from "../utils/memory/memoryManager.js";

// Simulate what aiResponder does
function simulateConversation() {
  const recentMemory = createRecentMemory(10);
  const summaryMemory = createSummaryMemory({ turnsThreshold: 3 });
  const memoryManager = createMemoryManager({ ttlHours: 24 });

  const memoryKey = "guild1:channel1:user1:yukinon";

  console.log("=== Multi-turn Conversation Test ===\n");

  // Turn 1: Hello
  console.log("Turn 1: User says 'Hello'");
  recentMemory.add(memoryKey, { sender: "user1", content: "Hello" });
  memoryManager.touch(memoryKey);
  console.log(`  Memory has ${recentMemory.get(memoryKey).length} turns\n`);

  // Turn 2: Ask name
  console.log("Turn 2: User asks 'What's my name?'");
  recentMemory.add(memoryKey, { sender: "user1", content: "What's my name?" });
  memoryManager.touch(memoryKey);
  const recentTurns = recentMemory.get(memoryKey);
  console.log(`  Memory has ${recentTurns.length} turns`);
  console.log("  Recent context:", recentTurns.map(t => t.content).join(" | "), "\n");

  // Turn 3: Provide name
  console.log("Turn 3: User says 'My name is Alice'");
  recentMemory.add(memoryKey, { sender: "user1", content: "My name is Alice" });
  memoryManager.touch(memoryKey);
  const facts = memoryManager.extractFacts("My name is Alice");
  console.log(`  Extracted facts:`, facts);
  console.log(`  Should save: ${memoryManager.shouldSaveFacts("My name is Alice")}\n`);

  // Turn 4: Ask name again
  console.log("Turn 4: User asks 'What's my name?' again");
  recentMemory.add(memoryKey, { sender: "user1", content: "What's my name?" });
  const finalTurns = recentMemory.get(memoryKey);
  console.log(`  Final turn count: ${finalTurns.length}`);
  console.log(`  Should save facts: ${memoryManager.shouldSaveFacts("What's my name?")}`);
  console.log(`  Should generate summary: ${summaryMemory.shouldSummarize(memoryKey, finalTurns)}\n`);

  console.log("=== Test Results ===");
  console.log("✓ Memory persists:", finalTurns.length === 4);
  console.log("✓ Context recall available:", finalTurns.some(t => t.content.includes("Alice")));
  console.log("✓ Fact extraction works:", facts.length > 0);
  console.log("✅ Multi-turn test complete\n");
}

simulateConversation();