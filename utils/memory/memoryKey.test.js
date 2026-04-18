import { describe, it, expect } from "vitest";
import { createMemoryKey, parseMemoryKey, isValidKey } from "./memoryKey.js";

describe("memoryKey", () => {
  it("should create memory key from components", () => {
    const key = createMemoryKey({
      guildId: "guild1",
      channelId: "channel1",
      userId: "user1",
      commandName: "yukinon",
    });
    expect(key).toBe("guild1:channel1:user1:yukinon");
  });

  it("should parse memory key back to components", () => {
    const key = "guild1:channel1:user1:yukinon";
    const parsed = parseMemoryKey(key);
    expect(parsed.guildId).toBe("guild1");
    expect(parsed.channelId).toBe("channel1");
    expect(parsed.userId).toBe("user1");
    expect(parsed.commandName).toBe("yukinon");
  });

  it("should validate key components", () => {
    expect(
      isValidKey({
        guildId: "guild1",
        channelId: "channel1",
        userId: "user1",
        commandName: "yukinon",
      })
    ).toBe(true);

    expect(
      isValidKey({
        guildId: null,
        channelId: "channel1",
        userId: "user1",
        commandName: "yukinon",
      })
    ).toBe(false);
  });

  it("should parse invalid key as null", () => {
    expect(parseMemoryKey("invalid")).toBeNull();
    expect(parseMemoryKey("")).toBeNull();
  });
});