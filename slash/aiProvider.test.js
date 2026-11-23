import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildModelWarning,
  buildProviderUpdateData,
  getCredentialLabel,
  getModelAutocompleteChoices,
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

describe("model autocomplete", () => {
  const catalog = (ids) => ({ listModels: vi.fn(async () => ids), peek: vi.fn(() => ids) });
  const interaction = ({ userId = "1", sub, focused = "fla", strings = {} }) => ({
    user: { id: userId },
    options: {
      getSubcommand: () => sub,
      getFocused: (full) => (full ? { name: "model", value: focused } : focused),
      getString: (n) => strings[n] ?? null,
    },
  });

  it("returns nothing for non-admins", async () => {
    const c = catalog(["flash"]);
    const out = await getModelAutocompleteChoices(interaction({ userId: "9", sub: "add" }), {
      catalog: c,
    });
    expect(out).toEqual([]);
    expect(c.listModels).not.toHaveBeenCalled();
  });

  it("uses add options and returns filtered name/value choices", async () => {
    process.env.AI_ADMIN_USER_IDS = "1";
    const c = catalog(["gemini-flash", "pro"]);
    const out = await getModelAutocompleteChoices(
      interaction({
        sub: "add",
        strings: { type: "openai-compatible", "base-url": "https://x.test/v1", "api-key": "k" },
      }),
      { catalog: c },
    );
    expect(out).toEqual([{ name: "gemini-flash", value: "gemini-flash" }]);
    expect(c.listModels).toHaveBeenCalledWith({
      type: "openai-compatible",
      baseUrl: "https://x.test/v1",
      apiKey: "k",
    });
  });

  it("uses the stored provider on update and returns nothing on failure", async () => {
    process.env.AI_ADMIN_USER_IDS = "1";
    const provider = { type: "openai-compatible", baseUrl: "https://x.test/v1", id: 1 };
    const c = catalog(["flash"]);
    const out = await getModelAutocompleteChoices(
      interaction({ sub: "update", strings: { name: "p" } }),
      { catalog: c, findProvider: async () => provider, getApiKey: () => "dec" },
    );
    expect(out).toEqual([{ name: "flash", value: "flash" }]);
    expect(c.listModels).toHaveBeenCalledWith({
      type: "openai-compatible",
      baseUrl: "https://x.test/v1",
      apiKey: "dec",
    });

    const failing = await getModelAutocompleteChoices(
      interaction({ sub: "update", strings: { name: "p" } }),
      {
        catalog: c,
        findProvider: async () => provider,
        getApiKey: () => {
          throw new Error("no key");
        },
      },
    );
    expect(failing).toEqual([]);
    const nullList = await getModelAutocompleteChoices(
      interaction({ sub: "add", strings: { type: "gemini" } }),
      { catalog: catalog(null), getApiKey: () => "k" },
    );
    expect(nullList).toEqual([]);
  });

  it("warns only when a fetched list lacks the model", () => {
    expect(buildModelWarning("x", ["a"])).toContain("not in");
    expect(buildModelWarning("a", ["a"])).toBe("");
    expect(buildModelWarning("x", null)).toBe("");
  });
});
