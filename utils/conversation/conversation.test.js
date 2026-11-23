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
