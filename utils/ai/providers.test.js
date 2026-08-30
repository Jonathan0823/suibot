import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiGenerationError,
  createAiProviderService,
  generateWithGemini,
  generateWithOpenAiCompatible,
} from "./providers.js";
import {
  clearCredentialCache,
  getProviderApiKey,
} from "./config.js";
import { encryptApiKey } from "./crypto.js";

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

function dbFor(providers) {
  return {
    aiProvider: {
      findMany: vi.fn().mockResolvedValue(providers),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    aiSettings: {
      findUnique: vi.fn().mockResolvedValue(null),
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
      contents: "from user: hi",
      apiKey: "secret",
      fetchImpl,
    });

    expect(text).toBe("hello");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.test/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer secret" }),
      }),
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).messages).toEqual([
      { role: "system", content: "Be helpful" },
      { role: "user", content: "from user: hi" },
    ]);
  });

  it("supports text parts in a compatible response", async () => {
    const text = await generateWithOpenAiCompatible(openAiProvider("test"), {
      systemInstruction: "Be helpful",
      contents: "hi",
      apiKey: "secret",
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: [{ type: "text", text: "hello" }] } }],
        }),
      }),
    });

    expect(text).toBe("hello");
  });
});

describe("AI provider service", () => {
  it("falls back to the next provider on a rate limit", async () => {
    const providers = [openAiProvider("first"), openAiProvider("second", 2)];
    const db = dbFor(providers);
    const fetchImpl = vi.fn()
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
      contents: "question",
    });

    expect(text).toBe("fallback");
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

    await expect(service.generate({ contents: "question" })).rejects.toBeInstanceOf(
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
        contents: "question",
        apiKey: "gemini-key",
        geminiClientFactory,
      },
    );

    expect(text).toBe("gemini reply");
    expect(generateContent).toHaveBeenCalledWith({
      model: "gemini-model",
      contents: "question",
      config: {
        systemInstruction: "system",
        tools: [{ googleSearch: {} }],
      },
    });
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
