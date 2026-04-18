/**
 * Prompt Builder
 * Builds prompts from layered context for Gemini API.
 */

import { createMemoryKey } from "../memory/memoryKey.js";

const DEFAULT_CONFIG = {
  systemRules: {
    timezone: "Asia/Jakarta or UTC +7",
    noContextInResponse: true,
  },
  maxRecentTurns: 8,
  maxSummaryLength: 400,
};

/**
 * Create a prompt builder with layered context
 * @param {object} config - Configuration options
 * @returns {object} Prompt builder functions
 */
export function createPromptBuilder(config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  return {
    /**
     * Build system instruction from persona + rules
     * @param {string} persona - Base persona instruction
     * @returns {string} Full system instruction
     */
    buildSystemInstruction(persona) {
      const rules = [
        `The timezone is ${cfg.systemRules.timezone}.`,
        cfg.systemRules.noContextInResponse
          ? "Don't reveal conversation context or internal notes in your response."
          : "",
      ]
        .filter(Boolean)
        .join(" ");

      return `${persona} ${rules}`;
    },

    /**
     * Build conversation context from memory layers
     * @param {object} memory - Memory layers
     * @returns {string} Formatted context
     */
    buildContext({ recentTurns = [], summary = "" }) {
      const parts = [];

      // Session summary (older context)
      if (summary) {
        parts.push(`[Session Summary] ${summary}`);
      }

      // Recent turns
      if (recentTurns.length > 0) {
        const recent = recentTurns.slice(-cfg.maxRecentTurns);
        const formatted = recent
          .map((msg) => `${msg.sender}: ${msg.content}`)
          .join("\n");
        parts.push(`[Recent Conversation]\n${formatted}`);
      }

      return parts.join("\n\n");
    },

    /**
     * Build full prompt for Gemini
     * @param {object} params - All prompt components
     * @returns {object} Contents + config for API
     */
    build({ systemInstruction, recentTurns, summary, currentMessage, user }) {
      // Build system instruction
      const system = this.buildSystemInstruction(systemInstruction);

      // Build context
      const context = this.buildContext({ recentTurns, summary });

      // Combine into contents
      const contents = context
        ? `${context}\n\nfrom ${user}: ${currentMessage}`
        : `from ${user}: ${currentMessage}`;

      return {
        contents,
        config: {
          systemInstruction: system,
          // Tools will be added by caller
        },
      };
    },
  };
}

export default { createPromptBuilder };