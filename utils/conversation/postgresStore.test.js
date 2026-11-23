import { describe, expect, it } from "vitest";
import { createPostgresStore } from "./postgresStore.js";

// Minimal in-memory stand-in for the Prisma Conversation delegate.
function fakePrisma() {
  const rows = [];
  const uniqueOf = (where) => where.guildId_channelId_userId_persona ?? where;
  const find = (w) => {
    const u = uniqueOf(w);
    return rows.find(
      (r) =>
        r.guildId === u.guildId &&
        r.channelId === u.channelId &&
        r.userId === u.userId &&
        r.persona === u.persona,
    );
  };
  return {
    rows,
    conversation: {
      findUnique: async ({ where }) => find(where) ?? null,
      findMany: async () => rows.map((r) => ({ ...r })),
      upsert: async ({ where, create, update }) => {
        const existing = find(where);
        if (!existing) {
          rows.push({ version: 0, ...create });
          return;
        }
        const { version, ...rest } = update;
        Object.assign(existing, rest, { version: existing.version + version.increment });
      },
      deleteMany: async ({ where }) => {
        const row = find(where);
        if (row) rows.splice(rows.indexOf(row), 1);
        return { count: row ? 1 : 0 };
      },
    },
  };
}

const record = (overrides = {}) => ({
  recent: [
    { role: "user", text: "from Alice: hi" },
    { role: "model", text: "boo!" },
  ],
  summary: "Alice likes tea.",
  lastActive: 5_000,
  ...overrides,
});

describe("Postgres conversation store", () => {
  it("round-trips a record by its Conversation key and bumps the version on each save", async () => {
    const store = createPostgresStore({ prisma: fakePrisma() });
    await store.put("g1:c1:u1:hutao", record());
    expect(await store.get("g1:c1:u1:hutao")).toEqual({ ...record(), version: 0 });

    await store.put("g1:c1:u1:hutao", record({ summary: "new" }));
    expect(await store.get("g1:c1:u1:hutao")).toMatchObject({ summary: "new", version: 1 });
  });

  it("keeps the guild, channel, member and Persona as separate columns", async () => {
    const prisma = fakePrisma();
    await createPostgresStore({ prisma }).put("g1:c1:u1:hutao", record());
    expect(prisma.rows[0]).toMatchObject({
      guildId: "g1",
      channelId: "c1",
      userId: "u1",
      persona: "hutao",
      lastActive: new Date(5_000),
    });
  });

  it("returns null for unknown keys, forgets deleted ones, and lists keys", async () => {
    const store = createPostgresStore({ prisma: fakePrisma() });
    expect(await store.get("g1:c1:u1:hutao")).toBeNull();
    await store.put("g1:c1:u1:hutao", record());
    await store.put("g1:c1:u2:firefly", record());
    expect(await store.keys()).toEqual(["g1:c1:u1:hutao", "g1:c1:u2:firefly"]);
    await store.delete("g1:c1:u1:hutao");
    expect(await store.get("g1:c1:u1:hutao")).toBeNull();
    expect(await store.keys()).toEqual(["g1:c1:u2:firefly"]);
  });

  it("stores a record with no last-active time as null and reads it back without one", async () => {
    const prisma = fakePrisma();
    const store = createPostgresStore({ prisma });
    await store.put("g1:c1:u1:hutao", record({ lastActive: undefined }));
    expect(prisma.rows[0].lastActive).toBeNull();
    expect((await store.get("g1:c1:u1:hutao")).lastActive).toBeUndefined();
  });
});
