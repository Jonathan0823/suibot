import { describe, it, expect, beforeEach } from "vitest";
import { createSummaryMemory } from "./summaryMemory.js";

describe("summaryMemory", () => {
  let memory;

  beforeEach(() => {
    memory = createSummaryMemory({ turnsThreshold: 3 });
  });

  it("should return empty summary below threshold", () => {
    const turns = [
      { sender: "user", content: "hello" },
      { sender: "bot", content: "hi" },
    ];
    expect(memory.shouldSummarize("test-key", turns)).toBe(false);
  });

  it("should generate summary above threshold", () => {
    const turns = [
      { sender: "user", content: "hello" },
      { sender: "bot", content: "hi" },
      { sender: "user", content: "how are you?" },
      { sender: "bot", content: "good" },
    ];
    expect(memory.shouldSummarize("test-key", turns)).toBe(true);
  });

  it("should compress turns into summary", () => {
    const turns = [];
    for (let i = 0; i < 5; i++) {
      turns.push({ sender: "user", content: `message ${i}` });
    }
    const summary = memory.generateSummary(turns);
    expect(summary).toContain("Previous 5 exchanges");
  });

  it("should clear entries", () => {
    memory.set("test-key", { turns: [], summary: "old summary" });
    memory.clear("test-key");
    expect(memory.get("test-key").summary).toBe("");
  });
});