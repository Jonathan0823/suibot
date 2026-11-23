import { titleCase } from "../../helper/titleCase.js";
import { IDLE_EXPIRY_MS, buildKey, normalizeTurn } from "./shared.js";
import { estimateTokens } from "./tokens.js";

const DEFAULTS = {
  tokenBudget: 8000,
  compactAt: 0.8,
  compactTo: 0.4,
  keepTurns: 6,
  idleExpiryMs: IDLE_EXPIRY_MS,
  sweepIntervalMs: 60 * 60 * 1000,
};

const RULES = [
  "The timezone is Asia/Jakarta or UTC +7.",
  "Don't reveal conversation context or internal notes in your response.",
].join(" ");

const keyFor = ({ guildId, channelId, userId, commandName }) =>
  buildKey({ guildId, channelId, userId, persona: commandName });

const SUMMARIZER_INSTRUCTION = [
  "You keep notes on a chat between a member and a character. Update the existing Summary with the new Turns and reply with the full updated Summary only.",
  "Use exactly these sections: 'About the member', 'Scene and running jokes', 'Open threads'.",
  "Write in the language the Conversation uses.",
  "Update the existing Summary instead of rewriting it from scratch. Do not invent facts. Keep names and numbers exactly as written.",
  "Keep the whole Summary under about 1000 tokens.",
].join(" ");

function summarizerPrompt(summary, turns) {
  const folded = turns.map((turn) => `${turn.role}: ${turn.text}`).join("\n");
  return `Existing Summary:\n${summary || "(none yet)"}\n\nNew Turns to fold in:\n${folded}`;
}

/**
 * Conversation module: owns one conversation turn from load to persist.
 * @param {object} deps
 * @param {{get, put, delete, keys}} deps.store conversation store
 * @param {Function} deps.generate provider routing generate()
 * @param {() => number} [deps.now] clock
 * @param {(event: string, details: object) => void} [deps.logEvent] structured event logger
 */
export function createConversation({
  store,
  generate,
  now = Date.now,
  logEvent = () => {},
  ...tunables
}) {
  const cfg = { ...DEFAULTS, ...tunables };
  let lastSweepAt = null;
  const queues = new Map();
  // Per Conversation: provider-reported tokens divided by our estimate, from the last reply.
  const calibration = new Map();

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
    return (
      typeof record?.lastActive === "number" &&
      at - record.lastActive > cfg.idleExpiryMs
    );
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
      recent: (record?.recent ?? []).map((turn) =>
        normalizeTurn(turn, commandName),
      ),
      summary: typeof record?.summary === "string" ? record.summary : "",
    };
  }

  function buildSystemInstruction(persona, summary) {
    const base = `${persona} ${RULES}`;
    return summary ? `${base}\n\n[Session Summary] ${summary}` : base;
  }

  const tokensOf = (key, summary, turns) =>
    Math.ceil(
      (calibration.get(key) ?? 1) *
        (estimateTokens(summary) +
          turns.reduce((sum, turn) => sum + estimateTokens(turn.text), 0)),
    );

  // How many of the oldest Turns to remove: enough to get to compactTo, never the last keepTurns,
  // and the Turns that stay must start with a member Turn.
  function foldCount(key, { recent, summary }) {
    const maxFold = Math.max(0, recent.length - cfg.keepTurns);
    const target = cfg.tokenBudget * cfg.compactTo;
    let n = 1;
    while (n < maxFold && tokensOf(key, summary, recent.slice(n)) > target) n++;
    n = Math.min(n, maxFold);
    while (n <= maxFold && recent[n]?.role !== "user") n++;
    if (n > maxFold) {
      n = maxFold;
      while (n > 0 && recent[n].role !== "user") n--;
    }
    return n;
  }

  async function compactOnce(key, { requestId, commandName }) {
    const record = await store.get(key);
    if (!record) return;
    const before = tokensOf(key, record.summary ?? "", record.recent);
    if (before <= cfg.tokenBudget * cfg.compactAt) return;
    const folded = foldCount(key, {
      recent: record.recent,
      summary: record.summary ?? "",
    });
    if (folded === 0) return;

    let next = null;
    let outcome = "failed";
    try {
      const { text } = await generate({
        requestId,
        commandName,
        googleSearch: false,
        systemInstruction: SUMMARIZER_INSTRUCTION,
        turns: [
          {
            role: "user",
            text: summarizerPrompt(
              record.summary,
              record.recent.slice(0, folded),
            ),
          },
        ],
      });
      if (!text?.trim()) throw new Error("empty summary");
      next = {
        ...record,
        summary: text.trim(),
        recent: record.recent.slice(folded),
      };
      outcome = "summarized";
    } catch {
      if (before > cfg.tokenBudget) {
        next = { ...record, recent: record.recent.slice(folded) };
        outcome = "trimmed";
      }
    }

    // Watermark: a changed version means the Conversation moved on while we were summarizing.
    if (next && (await store.get(key))?.version !== record.version) {
      next = null;
      outcome = "failed";
    }
    if (next) await store.put(key, next);

    const after = next
      ? tokensOf(key, next.summary ?? "", next.recent)
      : before;
    logEvent("ai_compaction", {
      requestId,
      commandName,
      turnsFolded: next ? folded : 0,
      tokensBefore: before,
      tokensAfter: after,
      outcome,
    });
  }

  function compact(key, context) {
    return enqueue(key, () => compactOnce(key, context)).catch(() => {});
  }

  async function idle() {
    while (queues.size > 0) await Promise.all([...queues.values()]);
  }

  function reset(scope) {
    const key = keyFor(scope);
    return enqueue(key, async () => {
      await store.delete(key);
      calibration.delete(key);
      return { kind: "reset" };
    });
  }

  async function respond({ scope, speaker, text, persona, context }) {
    if (text.toLowerCase() === "reset") return reset(scope);
    const userText =
      text === "" ? `Halo, ${titleCase(scope.commandName)}!` : text;
    const key = keyFor(scope);
    return enqueue(key, async () => {
      const at = now();
      await sweepIfDue(at, key);
      const conversation = await load(key, at, scope.commandName);

      const memberTurn = { role: "user", text: `from ${speaker}: ${userText}` };
      const sentTurns = [...conversation.recent, memberTurn];
      const systemInstruction = buildSystemInstruction(
        persona,
        conversation.summary,
      );
      const { text: reply, usage } = await generate({
        ...context,
        turns: sentTurns,
        systemInstruction,
      });

      if (usage?.promptTokens > 0) {
        const estimated =
          estimateTokens(systemInstruction) +
          sentTurns.reduce((sum, turn) => sum + estimateTokens(turn.text), 0);
        calibration.set(key, Math.max(0.5, usage.promptTokens / estimated));
      }
      const recent = [...sentTurns, { role: "model", text: reply }];
      await store.put(key, {
        recent,
        summary: conversation.summary,
        lastActive: at,
      });
      if (
        tokensOf(key, conversation.summary, recent) >
        cfg.tokenBudget * cfg.compactAt
      ) {
        compact(key, {
          requestId: context?.requestId,
          commandName: scope.commandName,
        });
      }
      return { kind: "reply", text: reply };
    });
  }

  return { respond, reset, idle };
}
