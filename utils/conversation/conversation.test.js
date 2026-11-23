import { describe, expect, it } from "vitest";
import { createConversation } from "./conversation.js";
import { createMemoryStore } from "./memoryStore.js";

const scope = { guildId: "g1", channelId: "c1", userId: "u1", commandName: "hutao" };

function setup({ store = createMemoryStore(), replies = [], failWith } = {}) {
  const calls = [];
  let n = 0;
  const generate = async (request) => {
    calls.push(request);
    if (failWith) throw failWith;
    return { text: replies[n++] ?? `reply ${n}`, usage: null };
  };
  const make = () => createConversation({ store, generate, now: () => 1_000 });
  return { store, calls, conversation: make(), make };
}

const texts = (call) => call.turns.map((turn) => `${turn.role}: ${turn.text}`);

const say = (conversation, text, extra = {}) =>
  conversation.respond({ scope, speaker: "Alice", text, persona: "You are Hu Tao.", ...extra });

describe("Conversation", () => {
  it("returns the reply and sends the persona plus fixed rules and the message", async () => {
    const { conversation, calls } = setup({ replies: ["boo!"] });
    const result = await say(conversation, "hi");
    expect(result).toEqual({ kind: "reply", text: "boo!" });
    expect(calls[0].turns).toEqual([{ role: "user", text: "from Alice: hi" }]);
    expect(calls[0].systemInstruction).toBe(
      "You are Hu Tao. The timezone is Asia/Jakarta or UTC +7. Don't reveal conversation context or internal notes in your response.",
    );
  });

  it("includes the previous exchange in the next prompt", async () => {
    const { conversation, calls } = setup({ replies: ["boo!"] });
    await say(conversation, "hi");
    await say(conversation, "again");
    expect(calls[1].turns).toEqual([
      { role: "user", text: "from Alice: hi" },
      { role: "model", text: "boo!" },
      { role: "user", text: "from Alice: again" },
    ]);
  });

  it("remembers the latest exchange after a restart (no one-behind bug)", async () => {
    const { conversation, make, calls } = setup({ replies: ["boo!"] });
    await say(conversation, "hi");
    await say(make(), "again");
    expect(texts(calls[1])).toEqual([
      "user: from Alice: hi",
      "model: boo!",
      "user: from Alice: again",
    ]);
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
      expect(call.turns).toEqual([{ role: "user", text: "from Alice: hello" }]);
    }
  });

  it("resets on text 'reset' in any case, clearing memory and store", async () => {
    const { conversation, make, store, calls } = setup();
    await say(conversation, "hi");
    expect(await say(conversation, "ReSeT")).toEqual({ kind: "reset" });
    expect(await store.keys()).toEqual([]);
    await say(make(), "hello");
    expect(calls.at(-1).turns).toEqual([{ role: "user", text: "from Alice: hello" }]);
  });

  it("reset(scope) clears the conversation", async () => {
    const { conversation, store, calls } = setup();
    await say(conversation, "hi");
    expect(await conversation.reset(scope)).toEqual({ kind: "reset" });
    expect(await store.keys()).toEqual([]);
    await say(conversation, "hello");
    expect(calls.at(-1).turns).toEqual([{ role: "user", text: "from Alice: hello" }]);
  });

  it("greets when text is empty", async () => {
    const { conversation, calls } = setup();
    await say(conversation, "", { scope: { ...scope, commandName: "hu tao" } });
    expect(calls[0].turns).toEqual([{ role: "user", text: "from Alice: Halo, Hu Tao!" }]);
  });

  it("keeps a 10 turn window and prompts with the last 8", async () => {
    const { conversation, calls } = setup();
    for (let i = 1; i <= 7; i++) await say(conversation, `m${i}`);
    const turns = calls.at(-1).turns; // after 6 exchanges = 12 turns, window 10
    expect(turns).toHaveLength(9); // 8 recent + the new message
    expect(turns.at(-2)).toEqual({ role: "model", text: "reply 6" });
    expect(turns[0].role).toBe("user");
  });

  it("adds a summary from the updated turns once the threshold is reached", async () => {
    const { conversation, calls } = setup();
    for (let i = 1; i <= 5; i++) await say(conversation, `m${i}`);
    expect(calls.at(-1).systemInstruction).not.toContain("[Session Summary]");
    await say(conversation, "m6"); // 5 exchanges = 10 turns were stored after m5
    expect(calls.at(-1).systemInstruction).toContain(
      '[Session Summary] [Previous 10 exchanges: started with "from Alice: m1..."]',
    );
  });

  it("propagates generate errors and leaves the conversation unchanged", async () => {
    const store = createMemoryStore();
    const ok = setup({ store, replies: ["boo!"] });
    await say(ok.conversation, "hi");
    const before = await store.get((await store.keys())[0]);
    const boom = new Error("all providers failed");
    const bad = setup({ store, failWith: boom });
    await expect(say(bad.conversation, "again")).rejects.toBe(boom);
    expect(await store.get((await store.keys())[0])).toEqual(before);
    const next = setup({ store });
    await say(next.conversation, "later");
    expect(texts(next.calls[0])).toEqual([
      "user: from Alice: hi",
      "model: boo!",
      "user: from Alice: later",
    ]);
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

  it("stores each Turn once, in the form it was sent", async () => {
    const { conversation, store } = setup({ replies: ["boo!"] });
    await say(conversation, "hi");
    expect((await store.get("g1:c1:u1:hutao")).recent).toEqual([
      { role: "user", text: "from Alice: hi" },
      { role: "model", text: "boo!" },
    ]);
  });

  it("writes no fact entries", async () => {
    const { conversation, store } = setup();
    await say(conversation, "my name is Alice, remember that I prefer tea and also don't forget");
    expect(await store.keys()).toHaveLength(1);
  });
});

describe("Conversation queue", () => {
  it("handles two quick messages from one member one after the other, the second seeing the first's Turns", async () => {
    const calls = [];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const generate = async (request) => {
      calls.push(request);
      if (calls.length === 1) await gate;
      return { text: `reply ${calls.length}`, usage: null };
    };
    const conversation = createConversation({ store: createMemoryStore(), generate });

    const first = say(conversation, "one");
    const second = say(conversation, "two");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls).toHaveLength(1);
    release();
    await Promise.all([first, second]);

    expect(texts(calls[1])).toEqual([
      "user: from Alice: one",
      "model: reply 1",
      "user: from Alice: two",
    ]);
  });

  it("keeps running the queue after a failed operation", async () => {
    let n = 0;
    const generate = async () => {
      if (n++ === 0) throw new Error("boom");
      return { text: "ok", usage: null };
    };
    const conversation = createConversation({ store: createMemoryStore(), generate });
    const failed = expect(say(conversation, "one")).rejects.toThrow("boom");
    const next = say(conversation, "two");
    await failed;
    await expect(next).resolves.toEqual({ kind: "reply", text: "ok" });
  });

  it("runs different Conversations at the same time", async () => {
    let started = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const generate = async () => {
      started++;
      await gate;
      return { text: "ok", usage: null };
    };
    const conversation = createConversation({ store: createMemoryStore(), generate });
    const a = say(conversation, "a");
    const b = say(conversation, "b", { scope: { ...scope, userId: "u2" } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toBe(2);
    release();
    await Promise.all([a, b]);
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
      return { text: "boo!", usage: null };
    };
    const make = () => createConversation({ store, generate, now: () => clock.t, ...tunables });
    return { clock, store, calls, make, conversation: make() };
  }

  it("stamps last-active from the injected clock on every successful turn", async () => {
    const { clock, store, conversation } = clockSetup();
    clock.t = 5_000;
    await say(conversation, "hi");
    expect((await store.get(key)).lastActive).toBe(5_000);
    clock.t = 9_000;
    await say(conversation, "again");
    expect((await store.get(key)).lastActive).toBe(9_000);
  });

  it("starts empty when idle for more than 24 hours, and replaces the old record", async () => {
    const { clock, store, calls, conversation } = clockSetup();
    await say(conversation, "hi");
    clock.t = 86400000 + 1;
    await say(conversation, "again");
    expect(calls[1].turns).toEqual([{ role: "user", text: "from Alice: again" }]);
    expect(calls[1].systemInstruction).not.toContain("[Session Summary]");
    expect((await store.get(key)).recent).toHaveLength(2);
  });

  it("still remembers a conversation idle for exactly 24 hours", async () => {
    const { clock, calls, conversation } = clockSetup();
    await say(conversation, "hi");
    clock.t = 86400000;
    await say(conversation, "again");
    expect(texts(calls[1])).toContain("model: boo!");
  });

  it("expires across a simulated restart once the clock is past 24 hours", async () => {
    const { clock, calls, make, conversation } = clockSetup();
    await say(conversation, "hi");
    clock.t = 82800000;
    await say(make(), "still here");
    expect(texts(calls[1])).toContain("model: boo!");
    clock.t = 172800000;
    await say(make(), "gone");
    expect(calls[2].turns).toEqual([{ role: "user", text: "from Alice: gone" }]);
  });

  it("sweeps expired records from the store on a later turn", async () => {
    const { clock, store, conversation } = clockSetup();
    await say(conversation, "hi");
    clock.t = 90000000;
    await say(conversation, "other", { scope: { ...scope, commandName: "firefly" } });
    expect(await store.keys()).toEqual(["g1:c1:u1:firefly"]);
  });

  it("runs the sweep at most once per hour of injected-clock time", async () => {
    const { clock, store, conversation } = clockSetup();
    const other = (commandName) => ({ ...scope, commandName });
    await say(conversation, "r", { scope: other("hutao") }); // t=0, sweep runs
    clock.t = 84600000;
    await say(conversation, "s", { scope: other("firefly") }); // sweep runs, nothing expired yet
    clock.t = 86400001;
    await say(conversation, "t", { scope: other("yukinon") }); // expired, but last sweep was 30 min ago
    expect(await store.keys()).toContain(key);
    clock.t = 90000001;
    await say(conversation, "u", { scope: other("nahida") }); // an hour has passed: sweep
    expect(await store.keys()).not.toContain(key);
  });

  it("never expires a record without a last-active time; its next turn sets one", async () => {
    const { clock, store, calls, conversation } = clockSetup();
    await store.put(key, {
      recent: [
        { role: "user", text: "from Alice: hi" },
        { role: "model", text: "boo!" },
      ],
      summary: "",
    });
    clock.t = 86400000000;
    await say(conversation, "later");
    expect(texts(calls[0])).toEqual([
      "user: from Alice: hi",
      "model: boo!",
      "user: from Alice: later",
    ]);
    expect((await store.get(key)).lastActive).toBe(86400000000);
  });

  it("uses tunable idle expiry and sweep interval", async () => {
    const { clock, calls, conversation } = clockSetup({ idleExpiryMs: 1_000 });
    await say(conversation, "hi");
    clock.t = 1_001;
    await say(conversation, "again");
    expect(calls[1].turns).toEqual([{ role: "user", text: "from Alice: again" }]);
  });
});
