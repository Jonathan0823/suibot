import { describe, expect, it } from "vitest";
import { createConversation } from "./conversation.js";
import { createMemoryStore } from "./memoryStore.js";
import { estimateTokens } from "./tokens.js";

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

  it("starts each request with exactly the previous request's Turns while under budget", async () => {
    const { conversation, calls } = setup();
    for (let i = 1; i <= 12; i++) await say(conversation, `m${i}`);
    for (let n = 1; n < calls.length; n++) {
      const previous = texts(calls[n - 1]);
      expect(texts(calls[n]).slice(0, previous.length)).toEqual(previous);
      expect(calls[n].systemInstruction).toBe(calls[0].systemInstruction);
    }
    expect(calls.at(-1).turns).toHaveLength(23); // every stored Turn plus the new message
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
    expect(calls[1].systemInstruction).not.toContain("[Summary]");
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

describe("Conversation compaction", () => {
  const key = "g1:c1:u1:hutao";
  const BUDGET = 2000; // 80% = 1600, 40% = 800
  const big = "x".repeat(300); // about 100 estimated tokens per Turn
  const SUMMARY = "About the member\n- Alice likes tea";

  function compactionSetup({
    summarizer,
    logs = [],
    usage = null,
    store = createMemoryStore(),
  } = {}) {
    const calls = [];
    const generate = async (request) => {
      calls.push(request);
      if (request.googleSearch === false) {
        return summarizer ? summarizer(request) : { text: SUMMARY, usage: null };
      }
      return { text: big, usage };
    };
    const conversation = createConversation({
      store,
      generate,
      now: () => 1_000,
      tokenBudget: BUDGET,
      logEvent: (event, details) => logs.push({ event, details }),
    });
    const replies = () => calls.filter((call) => call.googleSearch !== false);
    const summaries = () => calls.filter((call) => call.googleSearch === false);
    return { store, calls, logs, conversation, replies, summaries };
  }

  const exchanges = async (conversation, count, extra = {}) => {
    for (let i = 1; i <= count; i++) await say(conversation, `${i}${big}`, extra);
    await conversation.idle();
  };

  it("does nothing while the Conversation is under 80% of the budget", async () => {
    const { conversation, summaries, store } = compactionSetup();
    await exchanges(conversation, 7);
    expect(summaries()).toHaveLength(0);
    expect((await store.get(key)).recent).toHaveLength(14);
  });

  it("folds the oldest Turns into the Summary after the reply once over 80%, down to 40% or less", async () => {
    const { conversation, summaries, store } = compactionSetup();
    await exchanges(conversation, 8);
    expect(summaries()).toHaveLength(1);
    const record = await store.get(key);
    expect(record.summary).toBe(SUMMARY);
    expect(record.recent).toHaveLength(6);
    expect(record.recent[0]).toEqual({ role: "user", text: `from Alice: 6${big}` });
    expect(record.recent.at(-1)).toEqual({ role: "model", text: big });
    const tokens = [...record.recent, { text: record.summary }].reduce(
      (sum, turn) => sum + estimateTokens(turn.text),
      0,
    );
    expect(tokens).toBeLessThanOrEqual(BUDGET * 0.4);
  });

  it("sends the reply before compacting", async () => {
    const order = [];
    const { conversation } = compactionSetup({
      summarizer: async () => {
        order.push("summary");
        return { text: SUMMARY, usage: null };
      },
    });
    await exchanges(conversation, 7);
    const result = await say(conversation, big);
    order.push("reply returned");
    await conversation.idle();
    expect(result.kind).toBe("reply");
    expect(order).toEqual(["reply returned", "summary"]);
  });

  it("asks the summarizer without Persona instructions or Google Search", async () => {
    const { conversation, summaries } = compactionSetup();
    await exchanges(conversation, 8, { context: { requestId: "r1", commandName: "hutao" } });
    const [request] = summaries();
    expect(request.googleSearch).toBe(false);
    expect(request.systemInstruction).not.toContain("You are Hu Tao.");
    for (const section of ["About the member", "Scene and running jokes", "Open threads"]) {
      expect(request.systemInstruction).toContain(section);
    }
    expect(request.requestId).toBe("r1");
    expect(request.turns[0].role).toBe("user");
    expect(request.turns[0].text).toContain(`from Alice: 1${big}`);
  });

  it("passes the existing Summary to the next Compaction so it is updated, not rewritten", async () => {
    const { conversation, summaries } = compactionSetup();
    await exchanges(conversation, 8);
    await exchanges(conversation, 6);
    expect(summaries()).toHaveLength(2);
    expect(summaries()[1].turns[0].text).toContain(SUMMARY);
  });

  it("puts the Summary in the system instruction of the next request", async () => {
    const { conversation, replies } = compactionSetup();
    await exchanges(conversation, 8);
    await say(conversation, "next");
    expect(replies().at(-1).systemInstruction).toContain(`[Summary] ${SUMMARY}`);
    expect(replies().at(-1).systemInstruction).not.toContain("Session Summary");
  });

  it("corrects the estimate with the provider-reported prompt tokens", async () => {
    const { conversation, summaries } = compactionSetup({
      usage: { promptTokens: 1700, outputTokens: 10 },
    });
    await exchanges(conversation, 5); // estimated about 1000 of 2000, reported 1700 for the prompt
    expect(summaries().length).toBeGreaterThan(0);
  });

  it("keeps the old Summary and Turns when Compaction fails, then retries after the next reply", async () => {
    let fail = true;
    const { conversation, summaries, store, logs } = compactionSetup({
      summarizer: async () => {
        if (fail) throw new Error("down");
        return { text: SUMMARY, usage: null };
      },
    });
    await exchanges(conversation, 8);
    const record = await store.get(key);
    expect(record.recent).toHaveLength(16);
    expect(record.summary).toBe("");
    expect(logs.at(-1).details.outcome).toBe("failed");
    fail = false;
    await exchanges(conversation, 1);
    expect(summaries()).toHaveLength(2);
    expect((await store.get(key)).summary).toBe(SUMMARY);
  });

  it("drops the oldest Turns, keeping the last 6, when a failed Compaction leaves it over 100%", async () => {
    const { conversation, store, logs } = compactionSetup({
      summarizer: async () => {
        throw new Error("down");
      },
    });
    await exchanges(conversation, 10); // 20 Turns, about 2000 tokens
    const record = await store.get(key);
    expect(record.recent.length).toBeGreaterThanOrEqual(6);
    expect(record.recent.length).toBeLessThan(20);
    expect(record.recent[0].role).toBe("user");
    expect(record.recent.at(-1)).toEqual({ role: "model", text: big });
    expect(record.summary).toBe("");
    expect(logs.at(-1).details.outcome).toBe("trimmed");
  });

  it("discards a Compaction result when the Conversation changed in the meantime", async () => {
    const store = createMemoryStore();
    const { conversation, logs } = compactionSetup({
      store,
      summarizer: async () => {
        const record = await store.get(key);
        await store.put(key, {
          ...record,
          recent: [...record.recent, { role: "user", text: "late" }],
        });
        return { text: SUMMARY, usage: null };
      },
    });
    await exchanges(conversation, 8);
    const record = await store.get(key);
    expect(record.summary).toBe("");
    expect(record.recent).toHaveLength(17);
    expect(logs.at(-1).details.outcome).toBe("failed");
  });

  it("logs ai_compaction with counts and outcome but no content", async () => {
    const { conversation, logs } = compactionSetup();
    await exchanges(conversation, 8, { context: { requestId: "r1", commandName: "hutao" } });
    const compactions = logs.filter((entry) => entry.event === "ai_compaction");
    expect(compactions).toHaveLength(1);
    const { details } = compactions[0];
    expect(Object.keys(details).sort()).toEqual([
      "commandName",
      "outcome",
      "requestId",
      "tokensAfter",
      "tokensBefore",
      "turnsFolded",
    ]);
    expect(details).toMatchObject({
      requestId: "r1",
      commandName: "hutao",
      turnsFolded: 10,
      outcome: "summarized",
    });
    expect(details.tokensBefore).toBeGreaterThan(BUDGET * 0.8);
    expect(details.tokensAfter).toBeLessThanOrEqual(BUDGET * 0.4);
    expect(JSON.stringify(logs)).not.toContain("xxxxx");
    expect(JSON.stringify(logs)).not.toContain("tea");
  });
});
