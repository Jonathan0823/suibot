import { describe, expect, it, vi } from "vitest";
import { createConversation } from "../conversation/conversation.js";
import { createMemoryStore } from "../conversation/memoryStore.js";
import { createToolLoop } from "./toolLoop.js";

const echoTool = {
  name: "echo",
  description: "Echo",
  parameters: { type: "object", properties: { text: { type: "string" } } },
  run: async ({ text }) => `echoed ${text}`,
};

function scripted(...replies) {
  const calls = [];
  const generate = vi.fn(async (request) => {
    calls.push(structuredClone(request));
    return replies[calls.length - 1];
  });
  return { generate, calls };
}

const call = (id) => ({
  text: "",
  toolCalls: [{ id, name: "echo", args: { text: id } }],
});

describe("tool loop", () => {
  it("runs a call, feeds the result back and returns the final reply", async () => {
    const { generate, calls } = scripted(call("a"), {
      text: "done",
      usage: null,
    });
    const loop = createToolLoop({ generate, tools: [echoTool] });

    const result = await loop({
      systemInstruction: "s",
      turns: [{ role: "user", text: "hi" }],
    });

    expect(result.text).toBe("done");
    expect(calls[0].toolDefs.map((tool) => tool.name)).toEqual(["echo"]);
    expect(calls[0].toolDefs[0]).not.toHaveProperty("run");
    expect(calls[1].toolRounds).toEqual([
      {
        calls: [{ id: "a", name: "echo", args: { text: "a" } }],
        results: [{ id: "a", name: "echo", output: "echoed a" }],
      },
    ]);
  });

  it("stops after 4 Tool rounds and makes a last call with tools off", async () => {
    const { generate, calls } = scripted(call("1"), call("2"), call("3"), call("4"), {
      text: "final",
    });
    const loop = createToolLoop({ generate, tools: [echoTool] });

    const result = await loop({ turns: [{ role: "user", text: "hi" }] });

    expect(result.text).toBe("final");
    expect(calls).toHaveLength(5);
    expect(calls[3].toolDefs).toBeDefined();
    expect(calls[4].toolDefs).toBeUndefined();
    expect(calls[4].googleSearch).toBe(false);
    expect(calls[4].toolRounds).toHaveLength(4);
  });

  it("returns an error result to the model when a Tool throws", async () => {
    const failing = {
      ...echoTool,
      run: async () => {
        throw new Error("boom secret");
      },
    };
    const { generate, calls } = scripted(call("a"), { text: "sorry" });
    const logEvent = vi.fn();
    const loop = createToolLoop({ generate, tools: [failing], logEvent });

    await loop({ requestId: "r1", turns: [{ role: "user", text: "hi" }] });

    expect(calls[1].toolRounds[0].results[0].output).toMatch(/^Tool error/);
    expect(logEvent).toHaveBeenCalledWith("ai_tool_use", {
      requestId: "r1",
      tool: "echo",
      durationMs: expect.any(Number),
      ok: false,
    });
    expect(JSON.stringify(logEvent.mock.calls)).not.toContain("boom");
  });

  it("reports an unknown Tool as an error result", async () => {
    const { generate, calls } = scripted(
      { text: "", toolCalls: [{ id: "x", name: "nope", args: {} }] },
      { text: "ok" },
    );
    const loop = createToolLoop({ generate, tools: [echoTool] });
    await loop({ turns: [{ role: "user", text: "hi" }] });
    expect(calls[1].toolRounds[0].results[0].output).toMatch(/^Tool error/);
  });

  it("does not offer Tools to requests that turn googleSearch off", async () => {
    const { generate, calls } = scripted({ text: "summary" });
    const loop = createToolLoop({ generate, tools: [echoTool] });
    await loop({
      googleSearch: false,
      turns: [{ role: "user", text: "fold" }],
    });
    expect(calls[0].toolDefs).toBeUndefined();
  });

  it("keeps only the member Turn and the reply Turn in the Conversation", async () => {
    const { generate } = scripted(call("a"), call("b"), {
      text: "final reply",
    });
    const loop = createToolLoop({ generate, tools: [echoTool] });
    const store = createMemoryStore();
    const conversation = createConversation({ store, generate: loop });
    const scope = {
      guildId: "g",
      channelId: "c",
      userId: "u",
      commandName: "suisei",
    };

    await conversation.respond({
      scope,
      speaker: "Alice",
      text: "hello",
      persona: "p",
      context: {},
    });

    const [key] = await store.keys();
    expect((await store.get(key)).recent).toEqual([
      { role: "user", text: "from Alice: hello" },
      { role: "model", text: "final reply" },
    ]);
  });
});
