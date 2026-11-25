import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../conversation/memoryStore.js";
import { personas } from "./index.js";
import { createPersonaResponder } from "./responder.js";

const makeMessage = () => {
  const sent = [];
  return {
    sent,
    guildId: "g1",
    channelId: "c1",
    author: { id: "u1", username: "someone", globalName: "Someone" },
    channel: { send: async (text) => void sent.push(text) },
  };
};

const persona = { trigger: "t", personaId: "testpersona", instruction: "Be a test." };

describe("createPersonaResponder", () => {
  it("sends a split reply and stores Turns under the personaId", async () => {
    const store = createMemoryStore();
    const requests = [];
    const long = Array.from({ length: 5 }, (_, i) => `line${i} ${"x".repeat(900)}`).join("\n");
    const generate = async (request) => {
      requests.push(request);
      return { text: long };
    };
    const responder = createPersonaResponder({ store, generate, logEvent: () => {} });
    const message = makeMessage();

    await responder.reply(message, persona, ["hello", "there"]);

    expect(message.sent.length).toBeGreaterThan(1);
    expect(message.sent.every((part) => part.length <= 2000)).toBe(true);
    expect(requests[0].systemInstruction).toContain("Be a test.");
    expect(await store.keys()).toEqual(["g1:c1:u1:testpersona"]);
    const record = await store.get("g1:c1:u1:testpersona");
    expect(record.recent.map((turn) => turn.role)).toEqual(["user", "model"]);
  });

  it("reports a failure to the channel", async () => {
    const generate = async () => {
      throw new Error("boom");
    };
    const responder = createPersonaResponder({
      store: createMemoryStore(),
      generate,
      logEvent: () => {},
    });
    const message = makeMessage();
    await responder.reply(message, persona, ["hi"]);
    expect(message.sent).toEqual(["Sorry, something went wrong with the AI generation."]);
  });
});

describe("personas", () => {
  it("have unique triggers and personaIds", () => {
    expect(new Set(personas.map((p) => p.trigger)).size).toBe(personas.length);
    expect(new Set(personas.map((p) => p.personaId)).size).toBe(personas.length);
    expect(personas.every((p) => p.instruction && p.description)).toBe(true);
  });
});
