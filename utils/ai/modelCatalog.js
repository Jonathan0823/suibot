import { createHash } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { PROVIDER_TYPES } from "./config.js";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 2500;
export const MAX_SUGGESTIONS = 25;

export function filterModelIds(ids, query, limit = MAX_SUGGESTIONS) {
  const needle = String(query || "").toLowerCase();
  const matches = ids.filter((id) => id.toLowerCase().includes(needle));
  const free = matches.filter((id) => id.endsWith(":free"));
  const rest = matches.filter((id) => !id.endsWith(":free"));
  return [...free, ...rest].slice(0, limit);
}

function getModelsUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error("unsupported protocol");
  const normalized = url.toString().replace(/\/$/, "").replace(/\/chat\/completions$/, "");
  return `${normalized}/models`;
}

function cacheKeyFor({ type, baseUrl, apiKey }) {
  const keyHash = createHash("sha256")
    .update(String(apiKey || ""))
    .digest("hex")
    .slice(0, 16);
  return `${type}|${baseUrl || ""}|${keyHash}`;
}

export function createModelCatalog({
  fetchImpl = (...args) => fetch(...args),
  geminiClientFactory = (apiKey) => new GoogleGenAI({ apiKey }),
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const cache = new Map();

  async function fetchGemini(apiKey) {
    const pager = await geminiClientFactory(apiKey).models.list();
    const ids = [];
    for await (const model of pager) {
      const actions = model.supportedActions || model.supportedGenerationMethods || [];
      if (actions.includes("generateContent") && model.name) {
        ids.push(model.name.replace(/^models\//, ""));
      }
    }
    return ids;
  }

  async function fetchOpenAiCompatible({ baseUrl, apiKey }) {
    const response = await fetchImpl(getModelsUrl(baseUrl), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error("model list request failed");
    const body = await response.json();
    return (body?.data || []).map((m) => m?.id).filter((id) => typeof id === "string" && id);
  }

  function peek(provider) {
    const entry = cache.get(cacheKeyFor(provider));
    if (!entry) return null;
    if (now() - entry.at >= ttlMs) {
      cache.delete(cacheKeyFor(provider));
      return null;
    }
    return entry.ids;
  }

  async function listModels(provider) {
    const cached = peek(provider);
    if (cached) return cached;
    try {
      const work =
        provider.type === PROVIDER_TYPES.GEMINI
          ? fetchGemini(provider.apiKey)
          : fetchOpenAiCompatible(provider);
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      });
      const ids = await Promise.race([work, timeout]).finally(() => clearTimeout(timer));
      work.catch(() => {});
      cache.set(cacheKeyFor(provider), { ids, at: now() });
      return ids;
    } catch {
      return null;
    }
  }

  return { listModels, peek };
}

export const modelCatalog = createModelCatalog();
