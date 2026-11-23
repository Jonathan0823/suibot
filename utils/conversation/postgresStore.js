import { buildKey, parseKey } from "./shared.js";

/**
 * Postgres conversation store. Same async interface as the memory store:
 * get / put / delete / keys. A key is "guildId:channelId:userId:persona".
 * @param {{prisma: import('@prisma/client').PrismaClient}} deps
 */
export function createPostgresStore({ prisma }) {
  const uniqueWhere = (key) => ({
    guildId_channelId_userId_persona: parseKey(key),
  });

  return {
    async get(key) {
      const row = await prisma.conversation.findUnique({
        where: uniqueWhere(key),
      });
      if (!row) return null;
      return {
        recent: Array.isArray(row.turns) ? row.turns : [],
        summary: row.summary,
        lastActive: row.lastActive ? row.lastActive.getTime() : undefined,
        version: row.version,
      };
    },
    async put(key, record) {
      const data = {
        summary: record.summary ?? "",
        turns: record.recent ?? [],
        lastActive:
          typeof record.lastActive === "number"
            ? new Date(record.lastActive)
            : null,
      };
      await prisma.conversation.upsert({
        where: uniqueWhere(key),
        create: { ...parseKey(key), ...data },
        update: { ...data, version: { increment: 1 } },
      });
    },
    async delete(key) {
      await prisma.conversation.deleteMany({ where: parseKey(key) });
    },
    async keys() {
      const rows = await prisma.conversation.findMany({
        select: { guildId: true, channelId: true, userId: true, persona: true },
      });
      return rows.map(buildKey);
    },
  };
}
