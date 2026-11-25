import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRouter } from "./router.js";

const makeDeps = ({ matched = false, admin = true } = {}) => {
  const calls = [];
  const deps = {
    triggerWords: { match: vi.fn(async () => (calls.push("trigger"), matched)) },
    personas: [{ trigger: "hutao" }],
    personaResponder: { reply: vi.fn(async () => calls.push("persona")) },
    alarms: { fire: vi.fn(async () => calls.push("alarm")) },
    slashCommands: [],
    isAdmin: vi.fn(() => admin),
  };
  return { deps, calls };
};

const msg = (content, extra = {}) => ({
  content,
  author: { bot: false, username: "u" },
  channel: { id: "ch" },
  client: {},
  reply: vi.fn(),
  ...extra,
});

describe("router messages", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("trigger words win and stop routing", async () => {
    const { deps } = makeDeps({ matched: true });
    const router = createRouter(deps);
    await router.onMessage(msg("?hutao hi"));
    expect(deps.personaResponder.reply).not.toHaveBeenCalled();
  });

  it("routes ? prefix to the persona after trigger words", async () => {
    const { deps, calls } = makeDeps();
    const router = createRouter(deps);
    const m = msg("?Hutao hello there");
    await router.onMessage(m);
    expect(calls).toEqual(["trigger", "persona"]);
    expect(deps.personaResponder.reply).toHaveBeenCalledWith(m, deps.personas[0], [
      "hello",
      "there",
    ]);
  });

  it("ignores unknown personas and bot authors", async () => {
    const { deps } = makeDeps();
    const router = createRouter(deps);
    await router.onMessage(msg("?nobody"));
    await router.onMessage(msg("?hutao", { author: { bot: true } }));
    expect(deps.personaResponder.reply).not.toHaveBeenCalled();
  });

  it("replies with an error when a persona throws", async () => {
    const { deps } = makeDeps();
    deps.personaResponder.reply.mockRejectedValue(new Error("x"));
    const m = msg("?hutao");
    await createRouter(deps).onMessage(m);
    expect(m.reply).toHaveBeenCalledWith("There was an error executing that command!");
  });

  it("fires debug alarms for admins only, before trigger words", async () => {
    const { deps, calls } = makeDeps();
    const router = createRouter(deps);
    await router.onMessage(msg("!alarm"));
    await router.onMessage(msg("!alarmwuwa"));
    expect(calls).toEqual(["alarm", "alarm"]);
    expect(deps.alarms.fire.mock.calls.map((c) => c[0])).toEqual(["hoyo", "wuwa"]);
    expect(deps.alarms.fire.mock.calls[0][1]).toEqual(["ch"]);

    const denied = makeDeps({ admin: false });
    await createRouter(denied.deps).onMessage(msg("!alarm"));
    expect(denied.deps.alarms.fire).not.toHaveBeenCalled();
  });
});

describe("router interactions", () => {
  const interaction = (over = {}) => ({
    commandName: "ping",
    isAutocomplete: () => false,
    isCommand: () => true,
    replied: false,
    deferred: false,
    reply: vi.fn(),
    ...over,
  });

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("dispatches slash commands", async () => {
    const { deps } = makeDeps();
    const execute = vi.fn();
    deps.slashCommands = [{ data: { name: "ping" }, execute }];
    const i = interaction();
    await createRouter(deps).onInteraction(i);
    expect(execute).toHaveBeenCalledWith(i);
  });

  it("dispatches autocomplete", async () => {
    const { deps } = makeDeps();
    const autocomplete = vi.fn();
    const execute = vi.fn();
    deps.slashCommands = [{ data: { name: "ping" }, execute, autocomplete }];
    await createRouter(deps).onInteraction(interaction({ isAutocomplete: () => true }));
    expect(autocomplete).toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("replies ephemerally when a slash command throws", async () => {
    const { deps } = makeDeps();
    deps.slashCommands = [
      { data: { name: "ping" }, execute: vi.fn().mockRejectedValue(new Error("x")) },
    ];
    const i = interaction();
    await createRouter(deps).onInteraction(i);
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: "There was an error executing this command!" }),
    );
  });
});
