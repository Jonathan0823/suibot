import { GoogleGenAI } from "@google/genai";
import { PROVIDER_TYPES, getProviderApiKey, loadAiConfig } from "./config.js";
import prisma from "../../lib/prisma.js";

const REQUEST_TIMEOUT_MS = 30_000;

export class AiProviderError extends Error {
  constructor(message, { status, errorType = "provider_error", fallback = false } = {}) {
    super(message);
    this.name = "AiProviderError";
    this.status = status;
    this.errorType = errorType;
    this.fallback = fallback;
  }
}

export class AiGenerationError extends Error {
  constructor(attempts) {
    super("All configured AI providers failed");
    this.name = "AiGenerationError";
    this.attempts = attempts;
  }
}

function fallbackForStatus(status) {
  return status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;
}

function errorForStatus(status) {
  let errorType = "http_error";
  if (status === 429) {
    errorType = "rate_limit";
  } else if (status >= 500) {
    errorType = "server_error";
  } else if (status === 401 || status === 403) {
    errorType = "authentication";
  }

  return new AiProviderError("AI provider request failed", {
    status,
    errorType,
    fallback: fallbackForStatus(status),
  });
}

function getChatCompletionsUrl(baseUrl) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw new AiProviderError("Provider base URL is required", { errorType: "configuration" });
  }

  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new AiProviderError("Provider base URL is invalid", { errorType: "configuration" });
  }

  if (!/^https?:$/.test(url.protocol)) {
    throw new AiProviderError("Provider base URL must use HTTP or HTTPS", {
      errorType: "configuration",
    });
  }

  const normalized = url.toString().replace(/\/$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

function getTimeoutSignal() {
  if (typeof AbortSignal?.timeout === "function") {
    return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS).unref?.();
  return controller.signal;
}

function getTextContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text")
    .map((part) => part?.text || "")
    .join("");
}

export async function generateWithOpenAiCompatible(
  provider,
  { systemInstruction, contents, apiKey, fetchImpl = fetch },
) {
  const url = getChatCompletionsUrl(provider.baseUrl);
  let response;

  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: contents },
        ],
      }),
      signal: getTimeoutSignal(),
    });
  } catch (error) {
    throw new AiProviderError("AI provider network request failed", {
      errorType:
        error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout" : "network",
      fallback: true,
    });
  }

  if (!response.ok) throw errorForStatus(response.status);

  let data;
  try {
    data = await response.json();
  } catch {
    throw new AiProviderError("AI provider returned invalid JSON", {
      errorType: "invalid_response",
      fallback: true,
    });
  }

  const text = getTextContent(data?.choices?.[0]?.message?.content);
  if (!text) {
    throw new AiProviderError("AI provider returned no text", {
      errorType: "invalid_response",
      fallback: true,
    });
  }
  return text;
}

export async function generateWithGemini(
  provider,
  {
    systemInstruction,
    contents,
    apiKey,
    geminiClientFactory = (key) => new GoogleGenAI({ apiKey: key }),
  },
) {
  try {
    const ai = geminiClientFactory(apiKey);
    const result = await ai.models.generateContent({
      model: provider.model,
      contents,
      config: {
        systemInstruction,
        tools: [{ googleSearch: {} }],
      },
    });
    const text = result?.text;
    if (!text) throw new Error("Gemini returned no text");
    return text;
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    const status = Number(error?.status || error?.statusCode);
    throw new AiProviderError("Gemini request failed", {
      status: Number.isFinite(status) ? status : undefined,
      errorType: Number.isFinite(status) ? "provider_error" : "network",
      fallback: Number.isFinite(status) ? fallbackForStatus(status) : true,
    });
  }
}

function validateProvider(provider) {
  if (!provider?.name || !provider?.model) {
    throw new AiProviderError("Provider name and model are required", {
      errorType: "configuration",
    });
  }
  if (![PROVIDER_TYPES.GEMINI, PROVIDER_TYPES.OPENAI_COMPATIBLE].includes(provider.type)) {
    throw new AiProviderError("Provider type is unsupported", { errorType: "configuration" });
  }
  if (provider.type === PROVIDER_TYPES.OPENAI_COMPATIBLE && !provider.baseUrl) {
    throw new AiProviderError("OpenAI-compatible provider base URL is required", {
      errorType: "configuration",
    });
  }
}

export function createAiProviderService({
  db = prisma,
  encryptionKey = process.env.AI_ENCRYPTION_KEY,
  fetchImpl = fetch,
  geminiClientFactory,
  logEvent = () => {},
} = {}) {
  async function call(provider, request) {
    validateProvider(provider);
    const apiKey = getProviderApiKey(provider, encryptionKey);

    if (provider.type === PROVIDER_TYPES.GEMINI) {
      return generateWithGemini(provider, { ...request, apiKey, geminiClientFactory });
    }
    return generateWithOpenAiCompatible(provider, { ...request, apiKey, fetchImpl });
  }

  async function generate(request) {
    const { providers, operationsChannelId } = await loadAiConfig(db);
    const attempts = [];

    for (const [index, provider] of providers.entries()) {
      const startedAt = Date.now();
      try {
        const text = await call(provider, request);
        logEvent("ai_request", {
          requestId: request.requestId,
          provider: provider.name,
          model: provider.model,
          status: "success",
          durationMs: Date.now() - startedAt,
          attempt: index + 1,
          fallback: index > 0,
        });
        return text;
      } catch (error) {
        const providerError =
          error instanceof AiProviderError
            ? error
            : new AiProviderError("AI provider request failed", { errorType: "provider_error" });
        const attempt = {
          provider: provider.name,
          model: provider.model,
          status: providerError.status,
          errorType: providerError.errorType,
          fallback: providerError.fallback,
          durationMs: Date.now() - startedAt,
        };
        attempts.push(attempt);
        logEvent("ai_provider_failure", {
          requestId: request.requestId,
          ...attempt,
          attempt: index + 1,
        });
        if (!providerError.fallback) break;
      }
    }

    await request.notifyFailure?.({
      requestId: request.requestId,
      commandName: request.commandName,
      operationsChannelId,
      attempts,
    });
    throw new AiGenerationError(attempts);
  }

  async function testProvider(providerName, request = {}) {
    const provider = await db.aiProvider.findUnique({ where: { name: providerName } });
    if (!provider)
      throw new AiProviderError("Provider was not found", { errorType: "configuration" });

    const startedAt = Date.now();
    await call(provider, {
      systemInstruction: "Reply with the single word OK.",
      contents: "Reply with the single word OK.",
      ...request,
    });
    return {
      provider: provider.name,
      model: provider.model,
      durationMs: Date.now() - startedAt,
    };
  }

  return { generate, testProvider };
}

export default createAiProviderService;
