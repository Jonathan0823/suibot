import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCredentialCache, getProviderApiKey } from "./config.js";
import { encryptApiKey } from "./crypto.js";
import {
  AiGenerationError,
  createAiProviderService,
  generateWithGemini,
  generateWithOpenAiCompatible,
} from "./providers.js";

const encryptionKey = Buffer.alloc(32, 9).toString("base64");

function openAiProvider(name, priority = 1) {
  const encrypted = encryptApiKey(`${name}-key`, encryptionKey);
  return {
    id: name,
    name,
    type: "openai-compatible",
    model: `${name}-model`,
    baseUrl: "https://example.test/v1",
    apiKeyCiphertext: encrypted.ciphertext,
    apiKeyIv: encrypted.iv,
    apiKeyAuthTag: encrypted.authTag,
    enabled: true,
    priority,
    createdAt: new Date(priority),
    updatedAt: new Date(priority),
  };
}

function dbFor(providers, settings = null) {
  return {
    aiProvider: {
      findMany: vi.fn().mockResolvedValue(providers),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    aiSettings: {
      findUnique: vi.fn().mockResolvedValue(settings),
    },
  };
}

afterEach(() => {
  clearCredentialCache();
  vi.restoreAllMocks();
  delete process.env.API_KEY;
});

describe("OpenAI-compatible provider", () => {
  it("sends system and user messages and returns response text", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "hello" } }] }),
    });

    const text = await generateWithOpenAiCompatible(openAiProvider("test"), {
      systemInstruction: "Be helpful",
      turns: [
        { role: "user", text: "from Alice: hi" },
        { role: "model", text: "hello there" },
        { role: "user", text: "from Alice: again" },
      ],
      apiKey: "secret",
      fetchImpl,
    });

    expect(text).toEqual({ text: "hello", usage: null });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.test/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer secret" }),
      }),
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).messages).toEqual([
      { role: "system", content: "Be helpful" },
      { role: "user", content: "from Alice: hi" },
      { role: "assistant", content: "hello there" },
      { role: "user", content: "from Alice: again" },
    ]);
  });

  it("returns token usage when reported and null when zero or missing", async () => {
    const run = (usage) =>
      generateWithOpenAiCompatible(openAiProvider("test"), {
        systemInstruction: "s",
        turns: [{ role: "user", text: "hi" }],
        apiKey: "secret",
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ choices: [{ message: { content: "hello" } }], usage }),
        }),
      });
    expect((await run({ prompt_tokens: 12, completion_tokens: 3 })).usage).toEqual({
      promptTokens: 12,
      outputTokens: 3,
    });
    expect((await run({ prompt_tokens: 0, completion_tokens: 0 })).usage).toBeNull();
    expect((await run(undefined)).usage).toBeNull();
  });

  it("supports text parts in a compatible response", async () => {
    const text = await generateWithOpenAiCompatible(openAiProvider("test"), {
      systemInstruction: "Be helpful",
      turns: [{ role: "user", text: "hi" }],
      apiKey: "secret",
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: [null, { type: "image" }, { type: "text", text: "hello" }],
              },
            },
          ],
        }),
      }),
    });

    expect(text.text).toBe("hello");
  });
});

describe("AI provider service", () => {
  it("falls back to the next provider on a rate limit", async () => {
    const providers = [openAiProvider("first"), openAiProvider("second", 2)];
    const db = dbFor(providers);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "fallback" } }] }),
      });

    const service = createAiProviderService({ db, encryptionKey, fetchImpl });
    const text = await service.generate({
      requestId: "request-1",
      commandName: "test",
      systemInstruction: "system",
      turns: [{ role: "user", text: "question" }],
    });

    expect(text.text).toBe("fallback");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops on a non-fallback client error", async () => {
    const providers = [openAiProvider("first"), openAiProvider("second", 2)];
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    const service = createAiProviderService({
      db: dbFor(providers),
      encryptionKey,
      fetchImpl,
    });

    await expect(service.generate({ turns: [{ role: "user", text: "question" }] })).rejects.toBeInstanceOf(
      AiGenerationError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses Gemini's native adapter and search tool", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: "gemini reply" });
    const geminiClientFactory = vi.fn().mockReturnValue({
      models: { generateContent },
    });

    const text = await generateWithGemini(
      { type: "gemini", model: "gemini-model" },
      {
        systemInstruction: "system",
        turns: [
          { role: "user", text: "q1" },
          { role: "user", text: "q2" },
          { role: "model", text: "a1" },
          { role: "user", text: "q3" },
        ],
        apiKey: "gemini-key",
        geminiClientFactory,
      },
    );

    expect(text).toEqual({ text: "gemini reply", usage: null });
    expect(generateContent).toHaveBeenCalledWith({
      model: "gemini-model",
      contents: [
        { role: "user", parts: [{ text: "q1\n\nq2" }] },
        { role: "model", parts: [{ text: "a1" }] },
        { role: "user", parts: [{ text: "q3" }] },
      ],
      config: {
        systemInstruction: "system",
        tools: [{ googleSearch: {} }],
      },
    });
  });

  it("removes the googleSearch tool when turned off", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: "ok" });
    await generateWithGemini(
      { type: "gemini", model: "gemini-model" },
      {
        systemInstruction: "system",
        turns: [{ role: "user", text: "q" }],
        googleSearch: false,
        apiKey: "k",
        geminiClientFactory: () => ({ models: { generateContent } }),
      },
    );
    expect(generateContent.mock.calls[0][0].config).toEqual({ systemInstruction: "system" });
  });

  it("reads Gemini usageMetadata and maps zero or missing to null", async () => {
    const run = (usageMetadata) =>
      generateWithGemini(
        { type: "gemini", model: "m" },
        {
          systemInstruction: "s",
          turns: [{ role: "user", text: "q" }],
          apiKey: "k",
          geminiClientFactory: () => ({
            models: { generateContent: vi.fn().mockResolvedValue({ text: "ok", usageMetadata }) },
          }),
        },
      );
    expect((await run({ promptTokenCount: 20, candidatesTokenCount: 5 })).usage).toEqual({
      promptTokens: 20,
      outputTokens: 5,
    });
    expect((await run({ promptTokenCount: 0, candidatesTokenCount: 0 })).usage).toBeNull();
    expect((await run(undefined)).usage).toBeNull();
  });

  it("rejects a Gemini Turn list that does not start with a user Turn", async () => {
    await expect(
      generateWithGemini(
        { type: "gemini", model: "m" },
        {
          systemInstruction: "s",
          turns: [{ role: "model", text: "hi" }],
          apiKey: "k",
          geminiClientFactory: () => ({ models: { generateContent: vi.fn() } }),
        },
      ),
    ).rejects.toMatchObject({ errorType: "configuration" });
  });
});

describe("provider credential cache", () => {
  it("invalidates cached credentials when updatedAt changes", () => {
    const first = encryptApiKey("first-key", encryptionKey);
    const second = encryptApiKey("second-key", encryptionKey);
    const provider = {
      id: "provider-1",
      type: "openai-compatible",
      apiKeyCiphertext: first.ciphertext,
      apiKeyIv: first.iv,
      apiKeyAuthTag: first.authTag,
      updatedAt: new Date(1),
    };

    expect(getProviderApiKey(provider, encryptionKey)).toBe("first-key");
    provider.apiKeyCiphertext = second.ciphertext;
    provider.apiKeyIv = second.iv;
    provider.apiKeyAuthTag = second.authTag;
    expect(getProviderApiKey(provider, encryptionKey)).toBe("first-key");
    provider.updatedAt = new Date(2);
    expect(getProviderApiKey(provider, encryptionKey)).toBe("second-key");
  });
});

describe("AI failure alerts", () => {
  const cooldownMs = 5 * 60 * 1000;
  const request = {
    requestId: "request-1",
    commandName: "yukinon",
    systemInstruction: "system",
    turns: [{ role: "user", text: "secret question" }],
  };

  function serviceFor(
    providers,
    {
      settings = { operationsChannelId: "ops-1" },
      fetchImpl,
      alert = vi.fn(),
      logEvent,
      clock,
    } = {},
  ) {
    const service = createAiProviderService({
      db: dbFor(providers, settings),
      encryptionKey,
      fetchImpl,
      alert,
      logEvent,
      clock,
    });
    return { service, alert };
  }

  function timeSource() {
    const state = { now: 0 };
    return { state, clock: () => state.now };
  }

  it("alerts once when every provider fails, with sanitised text", async () => {
    const providers = [openAiProvider("first"), openAiProvider("second", 2)];
    const rawBody = "RAW_UPSTREAM_BODY_7f3a";
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => rawBody })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => rawBody });
    const { service, alert } = serviceFor(providers, { fetchImpl });

    await expect(service.generate(request)).rejects.toBeInstanceOf(AiGenerationError);

    expect(alert).toHaveBeenCalledTimes(1);
    const [channelId, text] = alert.mock.calls[0];
    expect(channelId).toBe("ops-1");
    expect(text).toContain("yukinon");
    expect(text).toContain("request-1");
    expect(text).toContain("first (first-model) status 429");
    expect(text).toContain("second (second-model) status 500");
    expect(text).not.toContain(rawBody);
    expect(text).not.toContain("secret question");
    expect(text).not.toContain("first-key");
    expect(text).not.toContain("second-key");
  });

  it("does not alert again inside the cooldown", async () => {
    const { state, clock } = timeSource();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    const { service, alert } = serviceFor([openAiProvider("first")], { fetchImpl, clock });

    await expect(service.generate(request)).rejects.toBeInstanceOf(AiGenerationError);
    state.now = cooldownMs - 1;
    await expect(service.generate(request)).rejects.toBeInstanceOf(AiGenerationError);

    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("alerts again once the cooldown has passed", async () => {
    const { state, clock } = timeSource();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    const { service, alert } = serviceFor([openAiProvider("first")], { fetchImpl, clock });

    await expect(service.generate(request)).rejects.toBeInstanceOf(AiGenerationError);
    state.now = cooldownMs;
    await expect(service.generate(request)).rejects.toBeInstanceOf(AiGenerationError);

    expect(alert).toHaveBeenCalledTimes(2);
  });

  it("does not alert when no operations channel is configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    const { service, alert } = serviceFor([openAiProvider("first")], {
      settings: null,
      fetchImpl,
    });

    await expect(service.generate(request)).rejects.toBeInstanceOf(AiGenerationError);

    expect(alert).not.toHaveBeenCalled();
  });

  it("keeps the generation error when the alert throws", async () => {
    const logEvent = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    const alert = vi.fn().mockRejectedValue(new Error("discord down"));
    const { service } = serviceFor([openAiProvider("first")], { fetchImpl, alert, logEvent });

    await expect(service.generate(request)).rejects.toBeInstanceOf(AiGenerationError);

    await vi.waitFor(() =>
      expect(logEvent).toHaveBeenCalledWith(
        "ai_alert_failed",
        expect.objectContaining({ requestId: "request-1" }),
      ),
    );
  });

  it("rejects with the generation error without waiting for a pending alert", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    const alert = vi.fn(() => new Promise(() => {}));
    const { service } = serviceFor([openAiProvider("first")], { fetchImpl, alert });

    await expect(service.generate(request)).rejects.toBeInstanceOf(AiGenerationError);

    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("starts the cooldown even when sending the alert fails", async () => {
    const { state, clock } = timeSource();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    const alert = vi.fn().mockRejectedValue(new Error("discord down"));
    const { service } = serviceFor([openAiProvider("first")], { fetchImpl, alert, clock });

    await expect(service.generate(request)).rejects.toBeInstanceOf(AiGenerationError);
    state.now = 1000;
    await expect(service.generate(request)).rejects.toBeInstanceOf(AiGenerationError);

    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("does not alert when a fallback provider succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "fallback" } }] }),
      });
    const { service, alert } = serviceFor([openAiProvider("first"), openAiProvider("second", 2)], {
      fetchImpl,
    });

    await expect(service.generate(request)).resolves.toMatchObject({ text: "fallback" });

    expect(alert).not.toHaveBeenCalled();
  });

  it("alerts when a non-fallback error stops the loop early", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    const { service, alert } = serviceFor([openAiProvider("first"), openAiProvider("second", 2)], {
      fetchImpl,
    });

    await expect(service.generate(request)).rejects.toBeInstanceOf(AiGenerationError);

    expect(alert).toHaveBeenCalledTimes(1);
    const [, text] = alert.mock.calls[0];
    expect(text).toContain("first (first-model)");
    expect(text).not.toContain("second-model");
  });

  it("says none configured when no providers are configured", async () => {
    const { service, alert } = serviceFor([]);

    await expect(service.generate(request)).rejects.toBeInstanceOf(AiGenerationError);

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][1]).toContain("none configured");
  });
});
