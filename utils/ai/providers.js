import { GoogleGenAI } from "@google/genai";
import prisma from "../../lib/prisma.js";
import { getProviderApiKey, loadAiConfig, PROVIDER_TYPES } from "./config.js";

const REQUEST_TIMEOUT_MS = 30_000;
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

function safeLabel(value, fallback = "unknown") {
  return String(value || fallback)
    .replace(/[\r\n`]/g, "")
    .slice(0, 120);
}

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

function toUsage(promptTokens, outputTokens) {
  const prompt = Number(promptTokens) || 0;
  const output = Number(outputTokens) || 0;
  if (prompt === 0 && output === 0) return null;
  return { promptTokens: prompt, outputTokens: output };
}

function mergeTurns(turns) {
  const merged = [];
  for (const turn of turns ?? []) {
    const last = merged.at(-1);
    if (last && last.role === turn.role) last.text = `${last.text}\n\n${turn.text}`;
    else merged.push({ role: turn.role, text: turn.text });
  }
  return merged;
}

// null when the arguments are not a JSON object.
function parseJsonObject(text) {
  try {
    const value = JSON.parse(text || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// Tool rounds of one reply, as OpenAI-compatible messages.
function openAiToolMessages(toolRounds) {
  return (toolRounds ?? []).flatMap((round) => [
    {
      role: "assistant",
      content: null,
      tool_calls: round.calls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
      })),
    },
    ...round.results.map((result) => ({
      role: "tool",
      tool_call_id: result.id,
      content: result.output,
    })),
  ]);
}

// Tool rounds of one reply, as Gemini contents.
function geminiToolContents(toolRounds) {
  return (toolRounds ?? []).flatMap((round) => [
    {
      role: "model",
      parts: round.calls.map((call) => ({
        functionCall: { name: call.name, args: call.args ?? {} },
        ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
      })),
    },
    {
      role: "user",
      parts: round.results.map((result) => ({
        functionResponse: { name: result.name, response: { output: result.output } },
      })),
    },
  ]);
}

export async function generateWithOpenAiCompatible(
  provider,
  { systemInstruction, turns, toolDefs, toolRounds, apiKey, fetchImpl = fetch },
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
          ...turns.map((turn) => ({
            role: turn.role === "model" ? "assistant" : "user",
            content: turn.text,
          })),
          ...openAiToolMessages(toolRounds),
        ],
        ...(toolDefs?.length
          ? {
              tools: toolDefs.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
            }
          : {}),
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

  const message = data?.choices?.[0]?.message;
  const toolCalls = (message?.tool_calls ?? []).map((call) => {
    const args = parseJsonObject(call.function?.arguments);
    return {
      id: call.id,
      name: call.function?.name,
      args: args ?? {},
      ...(args ? {} : { invalidArgs: true }),
    };
  });
  const usage = toUsage(data?.usage?.prompt_tokens, data?.usage?.completion_tokens);
  const text = getTextContent(message?.content);
  if (toolCalls.length) return { text, toolCalls, usage };
  if (!text) {
    throw new AiProviderError("AI provider returned no text", {
      errorType: "invalid_response",
      fallback: true,
    });
  }
  return { text, usage };
}

export async function generateWithGemini(
  provider,
  {
    systemInstruction,
    turns,
    googleSearch = true,
    toolDefs,
    toolRounds,
    apiKey,
    geminiClientFactory = (key) => new GoogleGenAI({ apiKey: key }),
  },
) {
  try {
    const merged = mergeTurns(turns);
    if (merged[0]?.role !== "user") {
      throw new AiProviderError("Turn list must start with a user Turn", {
        errorType: "configuration",
      });
    }
    const ai = geminiClientFactory(apiKey);
    const result = await ai.models.generateContent({
      model: provider.model,
      contents: [
        ...merged.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] })),
        ...geminiToolContents(toolRounds),
      ],
      config: {
        systemInstruction,
        // Gemini rejects built-in googleSearch combined with function calling.
        ...(toolDefs?.length
          ? {
              tools: [
                {
                  functionDeclarations: toolDefs.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parametersJsonSchema: tool.parameters,
                  })),
                },
              ],
            }
          : googleSearch
            ? { tools: [{ googleSearch: {} }] }
            : {}),
      },
    });
    const parts = result?.candidates?.[0]?.content?.parts ?? [];
    const toolCalls = parts
      .filter((part) => part.functionCall)
      .map((part, index) => ({
        id: part.functionCall.id || `call_${index}`,
        name: part.functionCall.name,
        args: part.functionCall.args ?? {},
        ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
      }));
    const usage = toUsage(
      result?.usageMetadata?.promptTokenCount,
      result?.usageMetadata?.candidatesTokenCount,
    );
    if (toolCalls.length) return { text: "", toolCalls, usage };
    const text = result?.text;
    if (!text) throw new Error("Gemini returned no text");
    const sources = (result?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
      .map((chunk) => chunk?.web?.uri)
      .filter(Boolean);
    return { text, ...(sources.length ? { sources } : {}), usage };
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
  alert = async () => {},
  clock = () => Date.now(),
} = {}) {
  let lastAlertAt = null;

  async function call(provider, request) {
    validateProvider(provider);
    const apiKey = getProviderApiKey(provider, encryptionKey);

    if (provider.type === PROVIDER_TYPES.GEMINI) {
      return generateWithGemini(provider, { ...request, apiKey, geminiClientFactory });
    }
    return generateWithOpenAiCompatible(provider, { ...request, apiKey, fetchImpl });
  }

  async function sendFailureAlert({ requestId, commandName, operationsChannelId, attempts }) {
    if (!operationsChannelId) return;

    const now = clock();
    if (lastAlertAt !== null && now - lastAlertAt < ALERT_COOLDOWN_MS) return;
    lastAlertAt = now;

    const providers = attempts.length
      ? attempts
          .map(
            (attempt) =>
              `${safeLabel(attempt.provider)} (${safeLabel(attempt.model)}) status ${attempt.status ?? "none"}, ${safeLabel(attempt.errorType)}`,
          )
          .join(", ")
      : "none configured";
    try {
      await alert(
        operationsChannelId,
        `[AI alert] All providers failed for ${safeLabel(commandName)}. ` +
          `Providers: ${providers}. Request: ${safeLabel(requestId)}.`,
      );
    } catch (error) {
      logEvent("ai_alert_failed", { requestId, errorName: error?.name || "Error" });
    }
  }

  async function generate(request) {
    const { providers, operationsChannelId } = await loadAiConfig(db);
    const attempts = [];

    for (const [index, provider] of providers.entries()) {
      const startedAt = clock();
      try {
        const result = await call(provider, request);
        logEvent("ai_request", {
          requestId: request.requestId,
          provider: provider.name,
          model: provider.model,
          status: "success",
          durationMs: clock() - startedAt,
          attempt: index + 1,
          fallback: index > 0,
        });
        return result;
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
          durationMs: clock() - startedAt,
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

    // Fire-and-forget: the alert must not delay the user-facing generation error.
    sendFailureAlert({
      requestId: request.requestId,
      commandName: request.commandName,
      operationsChannelId,
      attempts,
    }).catch(() => {});
    throw new AiGenerationError(attempts);
  }

  async function testProvider(providerName, request = {}) {
    const provider = await db.aiProvider.findUnique({ where: { name: providerName } });
    if (!provider)
      throw new AiProviderError("Provider was not found", { errorType: "configuration" });

    const startedAt = clock();
    await call(provider, {
      systemInstruction: "Reply with the single word OK.",
      turns: [{ role: "user", text: "Reply with the single word OK." }],
      ...request,
    });
    return {
      provider: provider.name,
      model: provider.model,
      durationMs: clock() - startedAt,
    };
  }

  // Separate Gemini request with only googleSearch on, used by the web_search Tool.
  async function search(query) {
    const { providers } = await loadAiConfig(db);
    const provider = providers.find((candidate) => candidate.type === PROVIDER_TYPES.GEMINI);
    if (!provider) {
      throw new AiProviderError("No Gemini provider is available", { errorType: "configuration" });
    }
    return generateWithGemini(provider, {
      systemInstruction: "Answer the query briefly using web search. Keep it under 150 words.",
      turns: [{ role: "user", text: query }],
      googleSearch: true,
      apiKey: getProviderApiKey(provider, encryptionKey),
      geminiClientFactory,
    });
  }

  return { generate, testProvider, search };
}

export default createAiProviderService;
