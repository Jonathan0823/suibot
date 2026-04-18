/**
 * Recent Memory Layer
 * Stores the last N conversation turns for immediate context.
 */

export const RECENT_TURNS_DEFAULT = 10;

/**
 * Create a recent memory store
 * @param {number} maxTurns - Maximum turns to store (default 10)
 * @returns {object} Memory store with get/set methods
 */
export function createRecentMemory(maxTurns = RECENT_TURNS_DEFAULT) {
  const store = new Map();

  return {
    get(key) {
      return store.get(key) || [];
    },

    set(key, turns) {
      const trimmed = turns.slice(-maxTurns);
      store.set(key, trimmed);
    },

    add(key, entry) {
      const current = store.get(key) || [];
      const updated = [...current, entry].slice(-maxTurns);
      store.set(key, updated);
    },

    clear(key) {
      store.delete(key);
    },

    has(key) {
      return store.has(key);
    },
  };
}

export default { createRecentMemory };