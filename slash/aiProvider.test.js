import { afterEach, describe, expect, it } from "vitest";
import {
  buildProviderUpdateData,
  getCredentialLabel,
  isAuthorized,
  isTextChannel,
} from "./aiProvider.js";

afterEach(() => {
  delete process.env.AI_ADMIN_USER_IDS;
});

describe("AI provider admin authorization", () => {
  it("authorizes configured Discord user IDs only", () => {
    process.env.AI_ADMIN_USER_IDS = "111, 222";

    expect(isAuthorized({ user: { id: "222" } })).toBe(true);
    expect(isAuthorized({ user: { id: "333" } })).toBe(false);
  });

  it("denies everyone when no admin IDs are configured", () => {
    expect(isAuthorized({ user: { id: "111" } })).toBe(false);
  });

  it("builds provider updates without omitting a zero priority", () => {
    expect(
      buildProviderUpdateData({
        model: " model ",
        baseUrl: " https://example.test ",
        priority: 0,
        credentials: { apiKeyCiphertext: "ciphertext" },
      }),
    ).toEqual({
      model: "model",
      baseUrl: "https://example.test",
      priority: 0,
      apiKeyCiphertext: "ciphertext",
    });
    expect(buildProviderUpdateData({ priority: null })).toEqual({});
  });

  it("labels credentials without exposing their values", () => {
    expect(getCredentialLabel({ type: "gemini" })).toBe("API_KEY env");
    expect(getCredentialLabel({ type: "openai-compatible", apiKeyCiphertext: "secret" })).toBe(
      "encrypted key",
    );
    expect(getCredentialLabel({ type: "openai-compatible" })).toBe("missing key");
  });

  it("handles missing or non-text channels safely", () => {
    expect(isTextChannel({ isTextBased: () => true })).toBe(true);
    expect(isTextChannel({ isTextBased: () => false })).toBe(false);
    expect(isTextChannel(null)).toBe(false);
  });
});
