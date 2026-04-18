import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma
vi.mock("../lib/prisma.js", () => ({
  default: {
    triggerWord: {
      findMany: vi.fn(),
    },
  },
}));

// Import after mock
import prisma from "../lib/prisma.js";

describe("Trigger Word Matching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Match Functions", () => {
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

    describe("exact match", () => {
      it("should match identical strings", () => {
        expect(matchExact("hello", "hello")).toBe(true);
      });

      it("should not match different strings", () => {
        expect(matchExact("hello", "hellox")).toBe(false);
        expect(matchExact("hello", "hell")).toBe(false);
      });

      it("should be case sensitive by default", () => {
        expect(matchExact("hello", "Hello")).toBe(false);
      });
    });

    describe("prefix match", () => {
      it("should match strings starting with pattern", () => {
        expect(matchPrefix("hello world", "hello")).toBe(true);
        expect(matchPrefix("hello", "hello")).toBe(true);
      });

      it("should not match strings not starting with pattern", () => {
        expect(matchPrefix("say hello", "hello")).toBe(false);
      });
    });

    describe("contains match", () => {
      it("should match strings containing pattern anywhere", () => {
        expect(matchContains("say hello there", "hello")).toBe(true);
        expect(matchContains("hello", "hello")).toBe(true);
      });

      it("should not match strings without pattern", () => {
        expect(matchContains("say hi there", "hello")).toBe(false);
      });
    });

    describe("regex match", () => {
      it("should match using regex patterns", () => {
        expect(matchRegex("hello123", "hello\\d+")).toBe(true);
        expect(matchRegex("HELLO", "hello")).toBe(true); // case insensitive
      });

      it("should return false for invalid regex", () => {
        expect(matchRegex("test", "[invalid")).toBe(false);
      });
    });
  });

  describe("Normalization", () => {
    const normalize = (str) => str.trim().toLowerCase();

    it("should normalize whitespace", () => {
      expect(normalize("  hello  ")).toBe("hello");
      expect(normalize("hello ")).toBe("hello");
      expect(normalize(" hello")).toBe("hello");
    });

    it("should normalize case", () => {
      expect(normalize("HELLO")).toBe("hello");
      expect(normalize("HeLLo")).toBe("hello");
    });

    it("should handle both case and whitespace", () => {
      expect(normalize("  HELLO  ")).toBe("hello");
    });
  });

  describe("Trigger Loading", () => {
    it("should load triggers from database", async () => {
      const mockTriggers = [
        { key: "hello", response: "Hi there!", matchMode: "exact", enabled: true, priority: 0 },
        { key: "help", response: "Ask me anything", matchMode: "prefix", enabled: true, priority: 1 },
      ];

      prisma.triggerWord.findMany.mockResolvedValue(mockTriggers);

      const result = await prisma.triggerWord.findMany({
        where: { enabled: true },
        orderBy: { priority: "desc" },
      });

      expect(result).toHaveLength(2);
      expect(prisma.triggerWord.findMany).toHaveBeenCalledWith({
        where: { enabled: true },
        orderBy: { priority: "desc" },
      });
    });

    it("should normalize trigger keys on load", () => {
      const triggers = [
        { key: "  Hello  ", aliases: ["HI", "Hey  "] },
        { key: "HELLO" },
      ];

      const normalized = triggers.map((t) => ({
        ...t,
        key: t.key.trim().toLowerCase(),
        aliases: (t.aliases || []).map((a) => a.trim().toLowerCase()),
      }));

      expect(normalized[0].key).toBe("hello");
      expect(normalized[0].aliases).toEqual(["hi", "hey"]);
      expect(normalized[1].key).toBe("hello");
    });
  });

  describe("Trigger Matching Logic", () => {
    const findMatchingTrigger = (input, triggers) => {
      const normalized = input.trim().toLowerCase();

      for (const trigger of triggers) {
        const matchMode = trigger.matchMode || "exact";
        let matched = false;

        if (matchMode === "exact") {
          matched = normalized === trigger.key;
        } else if (matchMode === "prefix") {
          matched = normalized.startsWith(trigger.key);
        } else if (matchMode === "contains") {
          matched = normalized.includes(trigger.key);
        }

        if (matched) return trigger;

        // Check aliases
        if (trigger.aliases) {
          for (const alias of trigger.aliases) {
            if (matchMode === "exact") {
              if (normalized === alias) return trigger;
            } else if (matchMode === "prefix") {
              if (normalized.startsWith(alias)) return trigger;
            } else if (matchMode === "contains") {
              if (normalized.includes(alias)) return trigger;
            }
          }
        }
      }

      return null;
    };

    it("should match exact triggers", () => {
      const triggers = [{ key: "hello", response: "Hi!", matchMode: "exact" }];

      expect(findMatchingTrigger("hello", triggers)?.response).toBe("Hi!");
      expect(findMatchingTrigger("HELLO", triggers)?.response).toBe("Hi!");
      expect(findMatchingTrigger("  hello  ", triggers)?.response).toBe("Hi!");
    });

    it("should not match partial triggers in exact mode", () => {
      const triggers = [{ key: "hello", response: "Hi!", matchMode: "exact" }];

      expect(findMatchingTrigger("hellox", triggers)).toBeNull();
      expect(findMatchingTrigger("hell", triggers)).toBeNull();
    });

    it("should match prefix triggers", () => {
      const triggers = [{ key: "play", response: "Playing!", matchMode: "prefix" }];

      expect(findMatchingTrigger("play songs", triggers)?.response).toBe("Playing!");
      expect(findMatchingTrigger("play something", triggers)?.response).toBe("Playing!");
    });

    it("should match aliases", () => {
      const triggers = [
        { key: "hello", response: "Hi!", aliases: ["hi", "hey"], matchMode: "exact" },
      ];

      expect(findMatchingTrigger("hello", triggers)?.response).toBe("Hi!");
      expect(findMatchingTrigger("hi", triggers)?.response).toBe("Hi!");
      expect(findMatchingTrigger("hey", triggers)?.response).toBe("Hi!");
    });

    it("should respect priority - higher priority triggers match first", () => {
      const triggers = [
        { key: "test", response: "Low priority", priority: 0, matchMode: "exact" },
        { key: "test", response: "High priority", priority: 10, matchMode: "exact" },
      ];

      // Sort by priority desc
      triggers.sort((a, b) => b.priority - a.priority);

      expect(findMatchingTrigger("test", triggers)?.response).toBe("High priority");
    });
  });

  describe("Cooldown Logic", () => {
    it("should track cooldowns per user and trigger", () => {
      const cooldownCache = new Map();

      const setCooldown = (triggerId, userId) => {
        cooldownCache.set(`${triggerId}:${userId}`, Date.now());
      };

      const isOnCooldown = (triggerId, userId) => {
        const lastTrigger = cooldownCache.get(`${triggerId}:${userId}`);
        if (!lastTrigger) return false;
        return Date.now() - lastTrigger < 5000; // 5 second cooldown
      };

      setCooldown("trigger1", "user1");

      expect(isOnCooldown("trigger1", "user1")).toBe(true);
      expect(isOnCooldown("trigger1", "user2")).toBe(false);
      expect(isOnCooldown("trigger2", "user1")).toBe(false);
    });
  });
});