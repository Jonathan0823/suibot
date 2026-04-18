/**
 * Memory Manager
 * Manages memory lifecycle: TTL, auto-save, cleanup, and rules.
 */

import { createMemoryKey, createShortKey } from "./memoryKey.js";

const DEFAULT_TTL_HOURS = 24;

/**
 * Create a memory manager
 * @param {object} config - Configuration
 * @param {number} config.ttlHours - TTL for stale sessions (default 24)
 * @returns {object} Memory manager functions
 */
export function createMemoryManager({ ttlHours = DEFAULT_TTL_HOURS } = {}) {
  // Track when each memory key was last accessed
  const lastAccessed = new Map();

  return {
    /**
     * Touch a memory key to update last accessed time
     * @param {string} key - Memory key
     */
    touch(key) {
      lastAccessed.set(key, Date.now());
    },

    /**
     * Check if a memory key is stale
     * @param {string} key - Memory key
     * @returns {boolean} True if stale (expired)
     */
    isStale(key) {
      const lastTouch = lastAccessed.get(key);
      if (!lastTouch) return false;

      const staleMs = ttlHours * 60 * 60 * 1000;
      return Date.now() - lastTouch > staleMs;
    },

    /**
     * Get all potentially stale keys
     * @returns {string[]} Array of stale keys
     */
    getStaleKeys() {
      const stale = [];
      for (const [key, lastTouch] of lastAccessed) {
        const staleMs = ttlHours * 60 * 60 * 1000;
        if (Date.now() - lastTouch > staleMs) {
          stale.push(key);
        }
      }
      return stale;
    },

    /**
     * Run cleanup callback for stale keys
     * @param {Function} callback - Cleanup function (key) => void
     */
    cleanupStale(callback) {
      const staleKeys = this.getStaleKeys();
      for (const key of staleKeys) {
        callback(key);
        lastAccessed.delete(key);
      }
    },

    /**
     * Determine if memory should be cleared for a request
     * @param {object} params - Request params
     * @returns {object} { shouldClear, reason }
     */
    shouldClearMemory({ args, isReset, hasMemory }) {
      // Only clear on explicit reset command
      if (isReset) {
        return { shouldClear: true, reason: "explicit_reset" };
      }

      // Don't clear on empty args (was previous behavior)
      // Keep memory unless explicitly asked
      if (!args || args.length === 0) {
        return { shouldClear: false, reason: "empty_args_no_clear" };
      }

      return { shouldClear: false, reason: "keep_memory" };
    },

    /**
     * Extract potential facts from user message for auto-save
     * @param {string} userMessage - User's message
     * @returns {Array} Array of { key, value } facts
     */
    extractFacts(userMessage) {
      const facts = [];
      const lower = userMessage.toLowerCase();

      // Simple pattern matching for common facts
      // Name mentions
      const nameMatch = userMessage.match(/my name is (\w+)/i);
      if (nameMatch) {
        facts.push({ key: "name", value: nameMatch[1] });
      }

      // Preference patterns
      if (lower.includes("i prefer") || lower.includes("i like")) {
        facts.push({ key: "preference_detected", value: userMessage.slice(0, 100) });
      }

      // Task/goal patterns
      if (lower.includes(" Remind me") || lower.includes("don't forget")) {
        facts.push({ key: "reminder", value: userMessage });
      }

      return facts;
    },

    /**
     * Check if message should trigger memory save
     * @param {string} message - User message
     * @returns {boolean}
     */
    shouldSaveFacts(message) {
      const lower = message.toLowerCase();
      // Save facts for substantive messages
      return (
        lower.includes("my name") ||
        lower.includes("i prefer") ||
        lower.includes("call me") ||
        lower.includes("remember that") ||
        lower.includes("don't forget") ||
        message.length > 50
      );
    },
  };
}

export default { createMemoryManager };