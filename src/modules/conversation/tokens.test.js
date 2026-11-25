import { describe, expect, it } from "vitest";
import { estimateTokens } from "./tokens.js";

// Prompt token counts as reported by providers in `usage.promptTokens` for a bare text.
const RECORDED = [
  { text: "こんにちは、今日はいい天気ですね", promptTokens: 12 },
  { text: "ありがとう！また明日話そうね😊", promptTokens: 14 },
  { text: "(≧▽≦)ノ ヾ(＾∇＾)ノ♪ (｡•̀ᴗ-)✧", promptTokens: 24 },
  { text: "你好，今天过得怎么样？", promptTokens: 10 },
  { text: "Hello there, how are you doing today?", promptTokens: 9 },
];

describe("estimateTokens", () => {
  it.each(RECORDED)("is at least the provider count for $text", ({ text, promptTokens }) => {
    expect(estimateTokens(text)).toBeGreaterThanOrEqual(promptTokens);
  });

  it("weighs Japanese and kaomoji heavier than Latin text of the same length", () => {
    expect(estimateTokens("こんにちは")).toBeGreaterThan(estimateTokens("hello"));
    expect(estimateTokens("(≧▽≦)")).toBeGreaterThan(estimateTokens("(>_<)"));
  });

  it("is zero for empty text and grows with length", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("hello world")).toBeGreaterThan(estimateTokens("hello"));
  });
});
