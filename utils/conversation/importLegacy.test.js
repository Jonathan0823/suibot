import { describe, expect, it } from "vitest";
import { importLegacyConversations } from "./importLegacy.js";
import { createMemoryStore } from "./memoryStore.js";

const NOW = 10 * 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const legacy = {
  // legacy shape: sender/content turns, object summary, lastSaved
  "g1:c1:u1:hutao": {
    recent: [
      { sender: "Alice", content: "hi" },
      { sender: "hutao", content: "boo!" },
    ],
    summary: { turns: [], summary: '[Previous 10 exchanges: started with "hi..."]' },
    lastSaved: NOW - 1_000,
  },
  // current shape with a real summary
  "g1:c1:u2:firefly": {
    recent: [{ role: "user", text: "from Bob: yo" }],
    summary: "Bob likes tea.",
    lastActive: NOW - 2_000,
  },
  // current shape with a placeholder summary
  "g1:c1:u3:hutao": {
    recent: [{ role: "user", text: "from Cy: hey" }],
    summary: '[Previous 10 exchanges: started with "from Cy: hey..."]',
    lastActive: NOW - 3_000,
  },
  "g1:c1:u4:hutao": {
    recent: [{ role: "user", text: "old" }],
    summary: "",
    lastActive: NOW - DAY - 1,
  },
  "g1:c1:u1:hutao:fact:name": { value: "Alice" },
};

describe("legacy Conversation import", () => {
  it("copies recent Turns, drops placeholder summaries, skips idle and fact records", async () => {
    const store = createMemoryStore();
    const result = await importLegacyConversations({ records: legacy, store, now: () => NOW });

    expect(result).toEqual({ imported: 3, skipped: 2 });
    expect((await store.keys()).sort()).toEqual([
      "g1:c1:u1:hutao",
      "g1:c1:u2:firefly",
      "g1:c1:u3:hutao",
    ]);
    expect(await store.get("g1:c1:u1:hutao")).toEqual({
      recent: [
        { role: "user", text: "from Alice: hi" },
        { role: "model", text: "boo!" },
      ],
      summary: "",
      lastActive: NOW - 1_000,
    });
    expect((await store.get("g1:c1:u2:firefly")).summary).toBe("Bob likes tea.");
    expect((await store.get("g1:c1:u3:hutao")).summary).toBe("");
  });

  it("is safe to run twice: it never overwrites a Conversation already in the store", async () => {
    const store = createMemoryStore();
    await importLegacyConversations({ records: legacy, store, now: () => NOW });
    await store.put("g1:c1:u2:firefly", { recent: [], summary: "newer", lastActive: NOW });

    const again = await importLegacyConversations({ records: legacy, store, now: () => NOW });

    expect(again.imported).toBe(0);
    expect((await store.get("g1:c1:u2:firefly")).summary).toBe("newer");
    expect(await store.keys()).toHaveLength(3);
  });
});
