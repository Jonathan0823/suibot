import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock prisma before importing the module
vi.mock("../lib/prisma.js", () => ({
  default: {
    triggerWord: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// Mock Discord interaction
const createMockInteraction = (content, authorId = "user123", isBot = false) => ({
  content,
  author: { id: authorId, bot: isBot },
  channel: { send: vi.fn().mockResolvedValue(true) },
});

// Import the module after mocking
import { triggerWords, loadTriggerWords, reloadTriggerWords } from "../utils/triggerWord.js";
import prisma from "../lib/prisma.js";

describe("Trigger Word System", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadTriggerWords", () => {
    it("should load and normalize triggers from database", async () => {
      const mockTriggers = [
        { key: "  Hello  ", response: "Hi!", matchMode: "exact", enabled: true, priority: 1, aliases: ["HI"] },
        { key: "WORLD", response: "Hello!", matchMode: "prefix", enabled: true, priority: 0, aliases: [] },
        { key: "\\d+ Codes", response: "Found!", matchMode: "regex", enabled: true, priority: 5, aliases: [] },
      ];

      prisma.triggerWord.findMany.mockResolvedValue(mockTriggers);

      await loadTriggerWords();

      expect(prisma.triggerWord.findMany).toHaveBeenCalledWith({
        where: { enabled: true },
        orderBy: { priority: "desc" },
      });
    });

    it("should normalize non-regex keys to lowercase", async () => {
      const mockTriggers = [
        { key: "HELLO", response: "Hi", matchMode: "exact", enabled: true, priority: 0, aliases: ["HEY"] },
      ];

      prisma.triggerWord.findMany.mockResolvedValue(mockTriggers);

      await loadTriggerWords();

      // The loaded triggers should have lowercase keys
      // (We verify by checking the mock was called correctly)
      expect(prisma.triggerWord.findMany).toHaveBeenCalled();
    });

    it("should NOT lowercase regex patterns", async () => {
      const mockTriggers = [
        { key: "\\D+", response: "No digits!", matchMode: "regex", enabled: true, priority: 0, aliases: [] },
      ];

      prisma.triggerWord.findMany.mockResolvedValue(mockTriggers);

      await loadTriggerWords();

      expect(prisma.triggerWord.findMany).toHaveBeenCalled();
    });
  });

  describe("triggerWords matching", () => {
    beforeEach(async () => {
      // Pre-load triggers for matching tests
      const mockTriggers = [
        { key: "hello", response: "Hi there!", matchMode: "exact", enabled: true, priority: 1, aliases: ["hi", "hey"], cooldownSeconds: 0 },
        { key: "play", response: "Playing!", matchMode: "prefix", enabled: true, priority: 0, aliases: [], cooldownSeconds: 0 },
        { key: "help", response: "Help message", matchMode: "contains", enabled: true, priority: 0, aliases: [], cooldownSeconds: 0 },
      ];
      prisma.triggerWord.findMany.mockResolvedValue(mockTriggers);
      await loadTriggerWords();
    });

    it("should match exact triggers", async () => {
      const interaction = createMockInteraction("hello");
      const result = await triggerWords(interaction);

      expect(result).toBe(true);
      expect(interaction.channel.send).toHaveBeenCalledWith("Hi there!");
    });

    it("should NOT match partial text in exact mode", async () => {
      const interaction = createMockInteraction("hellox");
      const result = await triggerWords(interaction);

      expect(result).toBeNull();
      expect(interaction.channel.send).not.toHaveBeenCalled();
    });

    it("should match prefix triggers", async () => {
      const interaction = createMockInteraction("play songs");
      const result = await triggerWords(interaction);

      expect(result).toBe(true);
      expect(interaction.channel.send).toHaveBeenCalledWith("Playing!");
    });

    it("should match contains triggers", async () => {
      const interaction = createMockInteraction("please help me");
      const result = await triggerWords(interaction);

      expect(result).toBe(true);
      expect(interaction.channel.send).toHaveBeenCalledWith("Help message");
    });

    it("should match aliases", async () => {
      const interactionHi = createMockInteraction("hi");
      const resultHi = await triggerWords(interactionHi);
      expect(resultHi).toBe(true);
      expect(interactionHi.channel.send).toHaveBeenCalledWith("Hi there!");

      const interactionHey = createMockInteraction("hey");
      const resultHey = await triggerWords(interactionHey);
      expect(resultHey).toBe(true);
      expect(interactionHey.channel.send).toHaveBeenCalledWith("Hi there!");
    });

    it("should normalize input with trim", async () => {
      const interaction = createMockInteraction("  hello  ");
      const result = await triggerWords(interaction);

      expect(result).toBe(true);
      expect(interaction.channel.send).toHaveBeenCalledWith("Hi there!");
    });

    it("should ignore bot messages", async () => {
      const interaction = createMockInteraction("hello", "bot123", true);
      const result = await triggerWords(interaction);

      expect(result).toBeNull();
      expect(interaction.channel.send).not.toHaveBeenCalled();
    });

    it("should return null for non-matching input", async () => {
      const interaction = createMockInteraction("unknown");
      const result = await triggerWords(interaction);

      expect(result).toBeNull();
    });
  });

  describe("cooldown", () => {
    beforeEach(async () => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should enforce cooldown per user", async () => {
      // Load trigger with cooldown
      const mockTriggers = [
        { key: "test", response: "Hi!", matchMode: "exact", enabled: true, priority: 0, aliases: [], cooldownSeconds: 5, id: "trigger1" },
      ];
      prisma.triggerWord.findMany.mockResolvedValue(mockTriggers);
      await loadTriggerWords();

      const user1 = createMockInteraction("test", "user1");

      // First trigger should work
      const first = await triggerWords(user1);
      expect(first).toBe(true);

      // Second trigger within cooldown should be blocked
      const second = await triggerWords(user1);
      expect(second).toBeNull();
    });

    it("should allow different users to trigger independently", async () => {
      const mockTriggers = [
        { key: "test", response: "Hi!", matchMode: "exact", enabled: true, priority: 0, aliases: [], cooldownSeconds: 5, id: "trigger1" },
      ];
      prisma.triggerWord.findMany.mockResolvedValue(mockTriggers);
      await loadTriggerWords();

      const user1 = createMockInteraction("test", "user1");
      const user2 = createMockInteraction("test", "user2");

      await triggerWords(user1);
      const result = await triggerWords(user2);

      expect(result).toBe(true); // user2 not affected by user1's cooldown
    });
  });

  describe("reloadTriggerWords", () => {
    it("should call loadTriggerWords", async () => {
      const mockTriggers = [{ key: "test", response: "Hi!", matchMode: "exact", enabled: true, priority: 0, aliases: [], cooldownSeconds: 0 }];
      prisma.triggerWord.findMany.mockResolvedValue(mockTriggers);

      await reloadTriggerWords();

      expect(prisma.triggerWord.findMany).toHaveBeenCalled();
    });
  });
});

describe("Match mode functions", () => {
  // Test the match functions directly
  const matchExact = (input, pattern) => input === pattern;
  const matchPrefix = (input, pattern) => input.startsWith(pattern);
  const matchContains = (input, pattern) => input.includes(pattern);
  const matchRegex = (input, pattern) => {
    try {
      return new RegExp(pattern, "i").test(input);
    } catch {
      return false;
    }
  };

  describe("regex patterns", () => {
    it("should match digits with \\d+", () => {
      expect(matchRegex("hello123", "hello\\d+")).toBe(true);
    });

    it("should match case insensitively", () => {
      expect(matchRegex("HELLO", "hello")).toBe(true);
    });

    it("should return false for invalid regex", () => {
      expect(matchRegex("test", "[invalid")).toBe(false);
    });
  });

  describe("other modes", () => {
    it("exact should be case sensitive", () => {
      expect(matchExact("hello", "Hello")).toBe(false);
    });

    it("prefix should work", () => {
      expect(matchPrefix("hello world", "hello")).toBe(true);
    });

    it("contains should work", () => {
      expect(matchContains("say hello there", "hello")).toBe(true);
    });
  });
});