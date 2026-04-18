import { describe, it, expect, beforeEach } from "vitest";
import { createRecentMemory } from "./recentMemory.js";

describe("recentMemory", () => {
  let memory;

  beforeEach(() => {
    memory = createRecentMemory(5);
  });

  it("should initialize empty", () => {
    expect(memory.get("test-key")).toEqual([]);
  });

  it("should add entries", () => {
    memory.add("test-key", { sender: "user", content: "hello" });
    const turns = memory.get("test-key");
    expect(turns).toHaveLength(1);
    expect(turns[0].content).toBe("hello");
  });

  it("should slice to max turns", () => {
    for (let i = 0; i < 7; i++) {
      memory.add("test-key", { sender: `user${i}`, content: `msg${i}` });
    }
    const turns = memory.get("test-key");
    expect(turns).toHaveLength(5);
    expect(turns[0].content).toBe("msg2"); // Oldest dropped
    expect(turns[4].content).toBe("msg6"); // Newest kept
  });

  it("should clear entries", () => {
    memory.add("test-key", { sender: "user", content: "hello" });
    memory.clear("test-key");
    expect(memory.get("test-key")).toEqual([]);
  });
});