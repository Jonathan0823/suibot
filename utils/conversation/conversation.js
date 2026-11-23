import { titleCase } from "../../helper/titleCase.js";

const DEFAULTS = {
  recentWindow: 10,
  promptTurns: 8,
  summaryThreshold: 10,
  idleExpiryMs: 24 * 60 * 60 * 1000,
  sweepIntervalMs: 60 * 60 * 1000,
};

const RULES = [
  "The timezone is Asia/Jakarta or UTC +7.",
  "Don't reveal conversation context or internal notes in your response.",
].join(" ");

// Records written before Turns carried a role stored { sender, content }.
function normalizeTurn(turn, commandName) {
  if (turn.role) return turn;
  return turn.sender === commandName
    ? { role: "model", text: turn.content }
    : { role: "user", text: `from ${turn.sender}: ${turn.content}` };
}

function keyFor({ guildId, channelId, userId, commandName }) {
  return `${guildId}:${channelId}:${userId}:${commandName}`;
}

function summarize(turns) {
  const first = turns[0];
  return `[Previous ${turns.length} exchanges: started with "${first.text.slice(0, 50)}..."]`;
}

/**
 * Conversation module: owns one conversation turn from load to persist.
 * @param {object} deps
 * @param {{get, put, delete, keys}} deps.store conversation store
 * @param {Function} deps.generate provider routing generate()
 * @param {() => number} [deps.now] clock
 */
export function createConversation({ store, generate, now = Date.now, ...tunables }) {
  const cfg = { ...DEFAULTS, ...tunables };
  let lastSweepAt = null;
  const queues = new Map();

  // One operation at a time per Conversation key; different keys run concurrently.
  function enqueue(key, operation) {
    const run = (queues.get(key) ?? Promise.resolve()).then(operation);
    const tail = run.catch(() => {});
    queues.set(key, tail);
    tail.then(() => {
      if (queues.get(key) === tail) queues.delete(key);
    });
    return run;
  }

  function isExpired(record, at) {
    return typeof record?.lastActive === "number" && at - record.lastActive > cfg.idleExpiryMs;
  }

  // Skips `ownKey`: the caller is already inside that Conversation's queue and load() expires it.
  async function sweepIfDue(at, ownKey) {
    if (lastSweepAt !== null && at - lastSweepAt < cfg.sweepIntervalMs) return;
    lastSweepAt = at;
    for (const key of await store.keys()) {
      if (key === ownKey) continue;
      await enqueue(key, async () => {
        if (isExpired(await store.get(key), at)) await store.delete(key);
      });
    }
  }

  async function load(key, at, commandName) {
    let record = await store.get(key);
    if (isExpired(record, at)) {
      await store.delete(key);
      record = null;
    }
    return {
      recent: (record?.recent ?? []).map((turn) => normalizeTurn(turn, commandName)),
      summary: typeof record?.summary === "string" ? record.summary : "",
    };
  }

  function buildSystemInstruction(persona, summary) {
    const base = `${persona} ${RULES}`;
    return summary ? `${base}\n\n[Session Summary] ${summary}` : base;
  }

  function reset(scope) {
    const key = keyFor(scope);
    return enqueue(key, async () => {
      await store.delete(key);
      return { kind: "reset" };
    });
  }

  async function respond({ scope, speaker, text, persona, context }) {
    if (text.toLowerCase() === "reset") return reset(scope);
    const userText = text === "" ? `Halo, ${titleCase(scope.commandName)}!` : text;
    const key = keyFor(scope);
    return enqueue(key, async () => {
      const at = now();
      await sweepIfDue(at, key);
      const conversation = await load(key, at, scope.commandName);

      const memberTurn = { role: "user", text: `from ${speaker}: ${userText}` };
      const { text: reply } = await generate({
        ...context,
        turns: [...conversation.recent.slice(-cfg.promptTurns), memberTurn],
        systemInstruction: buildSystemInstruction(persona, conversation.summary),
      });

      const recent = [...conversation.recent, memberTurn, { role: "model", text: reply }].slice(
        -cfg.recentWindow,
      );
      const summary = recent.length >= cfg.summaryThreshold ? summarize(recent) : "";
      await store.put(key, { recent, summary, lastActive: at });
      return { kind: "reply", text: reply };
    });
  }

  return { respond, reset };
}
