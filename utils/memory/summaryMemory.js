/**
 * Summary Memory Layer
 * Compresses older conversation turns into a compact summary.
 */

export const SUMMARY_TURNS_THRESHOLD = 10;

/**
 * Create a summary memory store
 * @param {object} params - Configuration
 * @param {number} params.turnsThreshold - When to start summarizing (default 10)
 * @param {number} params.maxSummaryLength - Max summary length in chars (default 500)
 * @returns {object} Memory store with get/set/summarize methods
 */
export function createSummaryMemory({
  turnsThreshold = SUMMARY_TURNS_THRESHOLD,
  maxSummaryLength = 500,
} = {}) {
  const store = new Map();

  return {
    get(key) {
      return store.get(key) || { turns: [], summary: "" };
    },

    set(key, { turns, summary }) {
      store.set(key, { turns, summary });
    },

    /**
     * Generate summary from turns array
     * @param {Array} turns - Array of conversation turns
     * @returns {string} Compressed summary
     */
    generateSummary(turns) {
      if (turns.length < turnsThreshold) {
        return "";
      }
      // Simple summary: first message + count of exchanges
      const first = turns[0];
      const count = turns.length;
      return `[Previous ${count} exchanges: started with "${first.sender}: ${first.content.slice(0, 50)}..."]`;
    },

    shouldSummarize(key, currentTurns) {
      return currentTurns.length >= turnsThreshold;
    },

    clear(key) {
      store.delete(key);
    },

    has(key) {
      return store.has(key);
    },
  };
}

export default { createSummaryMemory };