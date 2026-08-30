import prisma from "../../lib/prisma.js";
import { decryptApiKey } from "./crypto.js";

export const PROVIDER_TYPES = {
  GEMINI: "gemini",
  OPENAI_COMPATIBLE: "openai-compatible",
};

const DEFAULT_GEMINI = {
  name: "gemini",
  type: PROVIDER_TYPES.GEMINI,
  model: "gemini-2.5-flash-lite",
  priority: 1000,
};

const credentialCache = new Map();
let geminiBootstrap;

function providerVersion(provider) {
  return provider.updatedAt instanceof Date
    ? provider.updatedAt.getTime()
    : String(provider.updatedAt);
}

export async function ensureGeminiProvider(db = prisma) {
  if (!process.env.API_KEY || geminiBootstrap) return;

  geminiBootstrap = db.aiProvider.upsert({
    where: { name: DEFAULT_GEMINI.name },
    update: {},
    create: DEFAULT_GEMINI,
  }).catch((error) => {
    geminiBootstrap = undefined;
    throw error;
  });

  await geminiBootstrap;
}

export async function loadAiConfig(db = prisma) {
  await ensureGeminiProvider(db);

  const [providers, settings] = await Promise.all([
    db.aiProvider.findMany({
      where: { enabled: true },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    }),
    db.aiSettings.findUnique({ where: { id: 1 } }),
  ]);

  return {
    providers,
    operationsChannelId: settings?.operationsChannelId || null,
  };
}

export function getProviderApiKey(provider, encryptionKey) {
  if (provider.type === PROVIDER_TYPES.GEMINI) {
    if (!process.env.API_KEY) {
      throw new Error("API_KEY is required for Gemini");
    }
    return process.env.API_KEY;
  }

  const version = providerVersion(provider);
  const cacheKey = `${provider.id}:${version}`;
  const cached = credentialCache.get(cacheKey);
  if (cached) return cached;

  const apiKey = decryptApiKey(
    {
      ciphertext: provider.apiKeyCiphertext,
      iv: provider.apiKeyIv,
      authTag: provider.apiKeyAuthTag,
    },
    encryptionKey,
  );

  for (const key of credentialCache.keys()) {
    if (key.startsWith(`${provider.id}:`) && key !== cacheKey) {
      credentialCache.delete(key);
    }
  }
  credentialCache.set(cacheKey, apiKey);
  return apiKey;
}

export function clearProviderCredentialCache(providerId) {
  for (const key of credentialCache.keys()) {
    if (key.startsWith(`${providerId}:`)) credentialCache.delete(key);
  }
}

export function clearCredentialCache() {
  credentialCache.clear();
}
