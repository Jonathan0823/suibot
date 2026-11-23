import { describe, expect, it, vi } from "vitest";
import { createModelCatalog, filterModelIds } from "./modelCatalog.js";

const geminiClient = (models) => ({
  models: {
    list: async () => ({
      async *[Symbol.asyncIterator]() {
        for (const m of models) yield m;
      },
    }),
  },
});

const jsonResponse = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });

describe("filterModelIds", () => {
  it("matches anywhere, ignoring case, capped at 25, free models first", () => {
    const ids = [
      "a/Paid-Flash",
      "b/flash:free",
      ...Array.from({ length: 40 }, (_, i) => `flash-${i}`),
    ];
    const out = filterModelIds(ids, "FLASH");
    expect(out).toHaveLength(25);
    expect(out[0]).toBe("b/flash:free");
    expect(filterModelIds(ids, "zzz")).toEqual([]);
  });
});

describe("model catalog", () => {
  it("lists Gemini models that support generateContent without the models/ prefix", async () => {
    const catalog = createModelCatalog({
      geminiClientFactory: () =>
        geminiClient([
          { name: "models/gemini-2.5-flash", supportedActions: ["generateContent"] },
          { name: "models/embed-1", supportedActions: ["embedContent"] },
        ]),
    });
    expect(await catalog.listModels({ type: "gemini", apiKey: "k" })).toEqual(["gemini-2.5-flash"]);
  });

  it("lists OpenAI-compatible models from {baseUrl}/models with a bearer key", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ id: "x/one" }, { id: "x/two:free" }] }),
    );
    const catalog = createModelCatalog({ fetchImpl });
    const out = await catalog.listModels({
      type: "openai-compatible",
      baseUrl: "https://example.test/v1/chat/completions/",
      apiKey: "secret",
    });
    expect(out).toEqual(["x/one", "x/two:free"]);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://example.test/v1/models");
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer secret");
  });

  it("caches per provider for the ttl and refetches afterwards", async () => {
    let t = 0;
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ id: "m" }] }));
    const catalog = createModelCatalog({ fetchImpl, now: () => t, ttlMs: 1000 });
    const p = { type: "openai-compatible", baseUrl: "https://example.test/v1", apiKey: "k" };
    await catalog.listModels(p);
    await catalog.listModels(p);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(catalog.peek(p)).toEqual(["m"]);
    await catalog.listModels({ ...p, apiKey: "other" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    t = 1001;
    expect(catalog.peek(p)).toBeNull();
    await catalog.listModels(p);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("returns null instead of throwing when the fetch fails", async () => {
    const bad = createModelCatalog({ fetchImpl: async () => jsonResponse({}, false) });
    const thrown = createModelCatalog({
      fetchImpl: async () => {
        throw new Error("boom secret");
      },
    });
    const p = { type: "openai-compatible", baseUrl: "https://example.test/v1", apiKey: "k" };
    expect(await bad.listModels(p)).toBeNull();
    expect(await thrown.listModels(p)).toBeNull();
    expect(await thrown.listModels({ ...p, baseUrl: "not a url" })).toBeNull();
  });
});
