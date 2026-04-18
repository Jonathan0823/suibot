import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryManager } from "./memoryManager.js";

describe("memoryManager", () => {
  let manager;

  beforeEach(() => {
    manager = createMemoryManager({ ttlHours: 1 });
  });

  it("should touch and track last access", () => {
    manager.touch("test-key");
    expect(manager.isStale("test-key")).toBe(false);
  });

  it("should return stale for unknown keys", () => {
    expect(manager.isStale("unknown-key")).toBe(false);
  });

  it("should not clear on empty args", () => {
    const result = manager.shouldClearMemory({
      args: [],
      isReset: false,
      hasMemory: true,
    });
    expect(result.shouldClear).toBe(false);
    expect(result.reason).toBe("empty_args_no_clear");
  });

  it("should clear on explicit reset", () => {
    const result = manager.shouldClearMemory({
      args: ["reset"],
      isReset: true,
      hasMemory: true,
    });
    expect(result.shouldClear).toBe(true);
    expect(result.reason).toBe("explicit_reset");
  });

  it("should extract name from message", () => {
    const facts = manager.extractFacts("My name is Alice");
    expect(facts).toHaveLength(1);
    expect(facts[0].key).toBe("name");
    expect(facts[0].value).toBe("Alice");
  });

  it("should detect preference messages", () => {
    expect(manager.shouldSaveFacts("I prefer dark mode")).toBe(true);
    expect(manager.shouldSaveFacts("hello")).toBe(false);
    expect(manager.shouldSaveFacts("a".repeat(60))).toBe(true);
  });
});