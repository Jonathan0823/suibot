import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createConversation } from "./conversation.js";
import { createFileStore } from "./fileStore.js";
import { createMemoryStore } from "./memoryStore.js";

const scope = { guildId: "g1", channelId: "c1", userId: "u1", commandName: "hutao" };

function setup({ store = createMemoryStore(), replies = [], failWith } = {}) {
  const calls = [];
  let n = 0;
  const generate = async (request) => {
    calls.push(request);
    if (failWith) throw failWith;
    return replies[n++] ?? `reply ${n}`;
  };
  const make = () => createConversation({ store, generate, now: () => 1_000 });
  return { store, calls, conversation: make(), make };
}

const say = (conversation, text, extra = {}) =>
  conversation.respond({ scope, speaker: "Alice", text, persona: "You are Hu Tao.", ...extra });

describe("Conversation", () => {
  it("returns the reply and sends the persona plus fixed rules and the message", async () => {
    const { conversation, calls } = setup({ replies: ["boo!"] });
    const result = await say(conversation, "hi");
    expect(result).toEqual({ kind: "reply", text: "boo!" });
    expect(calls[0].contents).toBe("from Alice: hi");
    expect(calls[0].systemInstruction).toBe(
      "You are Hu Tao. The timezone is Asia/Jakarta or UTC +7. Don't reveal conversation context or internal notes in your response.",
    );
  });

  it("includes the previous exchange in the next prompt", async () => {
    const { conversation, calls } = setup({ replies: ["boo!"] });
    await say(conversation, "hi");
    await say(conversation, "again");
    expect(calls[1].contents).toBe(
      "[Recent Conversation]\nAlice: hi\nhutao: boo!\n\nfrom Alice: again",
    );
  });

  it("remembers the latest exchange after a restart (no one-behind bug)", async () => {
    const { conversation, make, calls } = setup({ replies: ["boo!"] });
    await say(conversation, "hi");
    await say(make(), "again");
    expect(calls[1].contents).toContain("Alice: hi\nhutao: boo!");
  });

  it("isolates conversations by server, channel, user and persona", async () => {
    const { conversation, calls } = setup();
    await say(conversation, "secret");
    const others = [
      { ...scope, guildId: "g2" },
      { ...scope, channelId: "c2" },
      { ...scope, userId: "u2" },
      { ...scope, commandName: "firefly" },
    ];
    for (const other of others) {
      await say(conversation, "hello", { scope: other });
    }
    for (const call of calls.slice(1)) {
      expect(call.contents).toBe("from Alice: hello");
    }
  });

  it("resets on text 'reset' in any case, clearing memory and store", async () => {
    const { conversation, make, store, calls } = setup();
    await say(conversation, "hi");
    expect(await say(conversation, "ReSeT")).toEqual({ kind: "reset" });
    expect(store.keys()).toEqual([]);
    await say(make(), "hello");
    expect(calls.at(-1).contents).toBe("from Alice: hello");
  });

  it("reset(scope) clears the conversation", async () => {
    const { conversation, store, calls } = setup();
    await say(conversation, "hi");
    expect(await conversation.reset(scope)).toEqual({ kind: "reset" });
    expect(store.keys()).toEqual([]);
    await say(conversation, "hello");
    expect(calls.at(-1).contents).toBe("from Alice: hello");
  });

  it("greets when text is empty", async () => {
    const { conversation, calls } = setup();
    await say(conversation, "", { scope: { ...scope, commandName: "hu tao" } });
    expect(calls[0].contents).toBe("from Alice: Halo, Hu Tao!");
  });

  it("keeps a 10 turn window and prompts with the last 8", async () => {
    const { conversation, calls } = setup();
    for (let i = 1; i <= 7; i++) await say(conversation, `m${i}`);
    const prompt = calls.at(-1).contents; // after 6 exchanges = 12 turns, window 10
    const recent = prompt.split("[Recent Conversation]\n")[1].split("\n\nfrom")[0].split("\n");
    expect(recent).toHaveLength(8);
    expect(recent.at(-1)).toBe("hutao: reply 6");
  });

  it("adds a summary from the updated turns once the threshold is reached", async () => {
    const { conversation, calls } = setup();
    for (let i = 1; i <= 5; i++) await say(conversation, `m${i}`);
    expect(calls.at(-1).contents).not.toContain("[Session Summary]");
    await say(conversation, "m6"); // 5 exchanges = 10 turns were stored after m5
    expect(calls.at(-1).contents).toContain(
      '[Session Summary] [Previous 10 exchanges: started with "Alice: m1..."]',
    );
  });

  it("propagates generate errors and leaves the conversation unchanged", async () => {
    const store = createMemoryStore();
    const ok = setup({ store, replies: ["boo!"] });
    await say(ok.conversation, "hi");
    const before = store.get(store.keys()[0]);
    const boom = new Error("all providers failed");
    const bad = setup({ store, failWith: boom });
    await expect(say(bad.conversation, "again")).rejects.toBe(boom);
    expect(store.get(store.keys()[0])).toEqual(before);
    const next = setup({ store });
    await say(next.conversation, "later");
    expect(next.calls[0].contents).toBe(
      "[Recent Conversation]\nAlice: hi\nhutao: boo!\n\nfrom Alice: later",
    );
  });

  it("uses the persona passed on each call", async () => {
    const { conversation, calls } = setup();
    await say(conversation, "a", { persona: "Old persona." });
    await say(conversation, "b", { persona: "New persona." });
    expect(calls[1].systemInstruction.startsWith("New persona.")).toBe(true);
  });

  it("forwards context to generate untouched", async () => {
    const { conversation, calls } = setup();
    const context = { requestId: "r1", commandName: "hutao", notifyFailure: () => {} };
    await say(conversation, "hi", { context });
    expect(calls[0]).toMatchObject(context);
  });

  it("writes no fact entries", async () => {
    const { conversation, store } = setup();
    await say(conversation, "my name is Alice, remember that I prefer tea and also don't forget");
    expect(store.keys()).toHaveLength(1);
  });
});

describe("Conversation idle expiry", () => {
  const key = "g1:c1:u1:hutao";

  function clockSetup(tunables = {}) {
    const clock = { t: 0 };
    const store = createMemoryStore();
    const calls = [];
    const generate = async (request) => {
      calls.push(request);
      return "boo!";
    };
    const make = () => createConversation({ store, generate, now: () => clock.t, ...tunables });
    return { clock, store, calls, make, conversation: make() };
  }

  it("stamps last-active from the injected clock on every successful turn", async () => {
    const { clock, store, conversation } = clockSetup();
    clock.t = 5_000;
    await say(conversation, "hi");
    expect(store.get(key).lastActive).toBe(5_000);
    clock.t = 9_000;
    await say(conversation, "again");
    expect(store.get(key).lastActive).toBe(9_000);
  });

  it("starts empty when idle for more than 24 hours, and replaces the old record", async () => {
    const { clock, store, calls, conversation } = clockSetup();
    await say(conversation, "hi");
    clock.t = 86400000 + 1;
    await say(conversation, "again");
    expect(calls[1].contents).toBe("from Alice: again");
    expect(calls[1].systemInstruction).not.toContain("[Session Summary]");
    expect(store.get(key).recent).toHaveLength(2);
  });

  it("still remembers a conversation idle for exactly 24 hours", async () => {
    const { clock, calls, conversation } = clockSetup();
    await say(conversation, "hi");
    clock.t = 86400000;
    await say(conversation, "again");
    expect(calls[1].contents).toContain("Alice: hi\nhutao: boo!");
  });

  it("expires across a simulated restart once the clock is past 24 hours", async () => {
    const { clock, calls, make, conversation } = clockSetup();
    await say(conversation, "hi");
    clock.t = 82800000;
    await say(make(), "still here");
    expect(calls[1].contents).toContain("Alice: hi\nhutao: boo!");
    clock.t = 172800000;
    await say(make(), "gone");
    expect(calls[2].contents).toBe("from Alice: gone");
  });

  it("sweeps expired records from the store on a later turn", async () => {
    const { clock, store, conversation } = clockSetup();
    await say(conversation, "hi");
    clock.t = 90000000;
    await say(conversation, "other", { scope: { ...scope, commandName: "firefly" } });
    expect(store.keys()).toEqual(["g1:c1:u1:firefly"]);
  });

  it("runs the sweep at most once per hour of injected-clock time", async () => {
    const { clock, store, conversation } = clockSetup();
    const other = (commandName) => ({ ...scope, commandName });
    await say(conversation, "r", { scope: other("hutao") }); // t=0, sweep runs
    clock.t = 84600000;
    await say(conversation, "s", { scope: other("firefly") }); // sweep runs, nothing expired yet
    clock.t = 86400001;
    await say(conversation, "t", { scope: other("yukinon") }); // expired, but last sweep was 30 min ago
    expect(store.keys()).toContain(key);
    clock.t = 90000001;
    await say(conversation, "u", { scope: other("nahida") }); // an hour has passed: sweep
    expect(store.keys()).not.toContain(key);
  });

  it("never expires a record without a last-active time; its next turn sets one", async () => {
    const { clock, store, calls, conversation } = clockSetup();
    store.put(key, {
      recent: [
        { sender: "Alice", content: "hi" },
        { sender: "hutao", content: "boo!" },
      ],
      summary: "",
    });
    clock.t = 86400000000;
    await say(conversation, "later");
    expect(calls[0].contents).toContain("Alice: hi\nhutao: boo!");
    expect(store.get(key).lastActive).toBe(86400000000);
  });

  it("does not expire a legacy file record without a timestamp; its next turn sets one", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conversation-legacy-"));
    try {
      const file = path.join(dir, "memory.json");
      fs.writeFileSync(
        file,
        JSON.stringify({
          [key]: {
            recent: [
              { sender: "Alice", content: "hi" },
              { sender: "hutao", content: "boo!" },
            ],
            summary: "",
          },
        }),
      );
      const store = createFileStore({ storagePath: file });
      const calls = [];
      const generate = async (request) => {
        calls.push(request);
        return "boo!";
      };
      const conversation = createConversation({
        store,
        generate,
        now: () => 86400000000,
      });

      await say(conversation, "later");

      expect(calls[0].contents).toContain("Alice: hi\nhutao: boo!");
      expect(store.get(key).lastActive).toBe(86400000000);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses tunable idle expiry and sweep interval", async () => {
    const { clock, calls, conversation } = clockSetup({ idleExpiryMs: 1_000 });
    await say(conversation, "hi");
    clock.t = 1_001;
    await say(conversation, "again");
    expect(calls[1].contents).toBe("from Alice: again");
  });
});
