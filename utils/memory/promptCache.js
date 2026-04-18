/**
 * Prompt Cache
 * Caches static persona prompts to reduce API token usage.
 */

const promptCache = new Map();

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Get cached prompt or null
 * @param {string} commandName - Command identifier
 * @returns {string|null} Cached system instruction
 */
export function getCachedPrompt(commandName) {
  const entry = promptCache.get(commandName);
  if (!entry) return null;

  // Check TTL
  if (Date.now() > entry.expiresAt) {
    promptCache.delete(commandName);
    return null;
  }

  return entry.prompt;
}

/**
 * Cache a prompt for a command
 * @param {string} commandName - Command identifier
 * @param {string} prompt - System instruction
 * @param {number} ttlMs - Time to live in ms (optional)
 */
export function setCachedPrompt(commandName, prompt, ttlMs = DEFAULT_TTL_MS) {
  promptCache.set(commandName, {
    prompt,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Invalidate cached prompt
 * @param {string} commandName - Command identifier
 */
export function invalidatePrompt(commandName) {
  promptCache.delete(commandName);
}

/**
 * Check if prompt is cached
 * @param {string} commandName - Command identifier
 * @returns {boolean}
 */
export function hasCachedPrompt(commandName) {
  return promptCache.has(commandName) && getCachedPrompt(commandName) !== null;
}

/**
 * Clear all cached prompts
 */
export function clearAll() {
  promptCache.clear();
}

export default {
  getCachedPrompt,
  setCachedPrompt,
  invalidatePrompt,
  hasCachedPrompt,
  clearAll,
};