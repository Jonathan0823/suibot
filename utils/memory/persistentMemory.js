/**
 * Persistent Memory Layer
 * Stores user facts, preferences, and long-term context in the database.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Create a persistent memory store using Prisma
 * @param {object} params - Configuration
 * @param {number} params.ttlDays - How many days to keep unused memory (default 30)
 * @returns {object} Memory store with get/set/query methods
 */
export function createPersistentMemory({ ttlDays = 30 } = {}) {
  return {
    /**
     * Get all facts for a user in a specific context
     * @param {string} userId - Discord user ID
     * @param {string} guildId - Discord guild ID
     * @param {string} channelId - Discord channel ID
     * @returns {Promise<Array>} Array of stored facts
     */
    async get(userId, guildId, channelId) {
      try {
        return await prisma.userMemory.findMany({
          where: {
            userId,
            guildId,
            channelId,
          },
          orderBy: { createdAt: "desc" },
        });
      } catch (error) {
        console.error("PersistentMemory get error:", error);
        return [];
      }
    },

    /**
     * Store a fact for a user
     * @param {string} userId - Discord user ID
     * @param {string} guildId - Discord guild ID
     * @param {string} channelId - Discord channel ID
     * @param {string} key - Fact identifier
     * @param {string} value - Fact content
     */
    async set(userId, guildId, channelId, key, value) {
      try {
        await prisma.userMemory.upsert({
          where: {
            // Composite key for upsert
            id: `${userId}-${guildId}-${channelId}-${key}`.slice(0, 255),
          },
          update: { value, updatedAt: new Date() },
          create: { userId, guildId, channelId, key, value },
        });
      } catch (error) {
        console.error("PersistentMemory set error:", error);
      }
    },

    /**
     * Query facts containing a keyword
     * @param {string} userId - Discord user ID
     * @param {string} query - Search term
     * @returns {Promise<Array>} Matching facts
     */
    async query(userId, query) {
      try {
        return await prisma.userMemory.findMany({
          where: {
            userId,
            value: { contains: query },
          },
        });
      } catch (error) {
        console.error("PersistentMemory query error:", error);
        return [];
      }
    },

    /**
     * Clear all facts for a user in context
     * @param {string} userId - Discord user ID
     * @param {string} guildId - Discord guild ID
     * @param {string} channelId - Discord channel ID
     */
    async clear(userId, guildId, channelId) {
      try {
        await prisma.userMemory.deleteMany({
          where: { userId, guildId, channelId },
        });
      } catch (error) {
        console.error("PersistentMemory clear error:", error);
      }
    },

    /**
     * Clean up stale memories
     */
    async cleanup() {
      try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - ttlDays);
        await prisma.userMemory.deleteMany({
          where: {
            updatedAt: { lt: cutoff },
          },
        });
      } catch (error) {
        console.error("PersistentMemory cleanup error:", error);
      }
    },
  };
}

export default { createPersistentMemory };