import { describe, expect, it } from "vitest";
import { buildKey, normalizeTurn, parseKey } from "./shared.js";

describe("conversation shared helpers", () => {
  it("builds and parses a key, keeping colons in the persona", () => {
    const parts = { guildId: "g", channelId: "c", userId: "u", persona: "a:b" };
    expect(buildKey(parts)).toBe("g:c:u:a:b");
    expect(parseKey("g:c:u:a:b")).toEqual(parts);
  });

  it("normalizes legacy Turns and leaves role Turns alone", () => {
    expect(normalizeTurn({ sender: "hutao", content: "boo" }, "hutao")).toEqual(
      {
        role: "model",
        text: "boo",
      },
    );
    expect(normalizeTurn({ sender: "Al", content: "hi" }, "hutao")).toEqual({
      role: "user",
      text: "from Al: hi",
    });
    const turn = { role: "user", text: "x" };
    expect(normalizeTurn(turn, "hutao")).toBe(turn);
  });
});
