/**
 * Memory Key Generator
 * Creates scoped memory keys: guildId + channelId + userId + commandName
 */

/**
 * Generate a memory key from components
 * @param {object} params - Key components
 * @param {string} params.guildId - Discord guild/server ID
 * @param {string} params.channelId - Discord channel ID
 * @param {string} params.userId - Discord user ID
 * @param {string} params.commandName - Bot command name
 * @returns {string} Composite memory key
 */
export function createMemoryKey({ guildId, channelId, userId, commandName }) {
  return `${guildId}:${channelId}:${userId}:${commandName}`;
}

/**
 * Parse a memory key back to components
 * @param {string} key - Memory key string
 * @returns {object} Components or null if invalid
 */
export function parseMemoryKey(key) {
  const [guildId, channelId, userId, commandName] = key.split(":");
  if (!guildId || !channelId || !userId || !commandName) {
    return null;
  }
  return { guildId, channelId, userId, commandName };
}

/**
 * Create a short key (without userId) for command-level scope
 * @param {object} params - Key components
 * @returns {string} Short key
 */
export function createShortKey({ guildId, channelId, commandName }) {
  return `${guildId}:${channelId}:${commandName}`;
}

/**
 * Validate key components
 * @param {object} params - Components to validate
 * @returns {boolean} True if valid
 */
export function isValidKey({ guildId, channelId, userId, commandName }) {
  return !!(guildId && channelId && userId && commandName);
}

export default {
  createMemoryKey,
  parseMemoryKey,
  createShortKey,
  isValidKey,
};