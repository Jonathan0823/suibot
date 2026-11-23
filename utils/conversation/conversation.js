import { titleCase } from "../../helper/titleCase.js";
import { IDLE_EXPIRY_MS, buildKey, normalizeTurn } from "./shared.js";
import { estimateTokens } from "./tokens.js";

const DEFAULTS = {
  tokenBudget: 8000,
  compactAt: 0.8,
  compactTo: 0.4,
  keepTurns: 6,
  summaryTokens: 1000, // the Summary cap the summarizer is told to stay under
  idleExpiryMs: IDLE_EXPIRY_MS,
  sweepIntervalMs: 60 * 60 * 1000,
};

const RULES = [
  "The timezone is Asia/Jakarta or UTC +7.",
  "Don't reveal conversation context or internal notes in your response.",
].join(" ");

// error.name or errorType only, never message text.
const errorTypeOf = (error) => error?.errorType || error?.name || "unknown";

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
  let sweeping = false;
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
    return typeof record?.lastActive === "number" && at - record.lastActive > cfg.idleExpiryMs;
  }

  // Runs in the background, outside any Conversation's queue slot. Each expired Conversation is
  // deleted through its own queue, and lastSweepAt only advances once the whole sweep succeeded.
  async function sweep(at) {
    for (const key of await store.keys()) {
      await enqueue(key, async () => {
        if (isExpired(await store.get(key), at)) await store.delete(key);
      });
    }
  }

  function sweepIfDue(at) {
    if (sweeping || (lastSweepAt !== null && at - lastSweepAt < cfg.sweepIntervalMs)) return;
    sweeping = true;
    sweep(at)
      .then(() => {
        lastSweepAt = at;
      })
      .catch((error) => logEvent("ai_sweep_failed", { errorType: errorTypeOf(error) }))
      .finally(() => {
        sweeping = false;
      });
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
    return summary ? `${base}\n\n[Summary] ${summary}` : base;
  }

  const measure = (key, summaryTokens, turns) =>
    Math.ceil(
      (calibration.get(key) ?? 1) *
        (summaryTokens + turns.reduce((sum, turn) => sum + estimateTokens(turn.text), 0)),
    );
  const tokensOf = (key, summary, turns) => measure(key, estimateTokens(summary), turns);

  // Picks where to cut the oldest Turns: the Turns that stay must start with a member Turn.
  // Prefers the first such boundary at or after `wanted` (up to `maxCut`), then the last one before
  // it. With `pastMax`, a boundary beyond `maxCut` is the last resort so Compaction never stalls.
  function chooseCut(recent, wanted, maxCut, { pastMax = false } = {}) {
    const isBoundary = (i) => recent[i]?.role === "user";
    for (let i = Math.max(1, wanted); i <= maxCut; i++) if (isBoundary(i)) return i;
    for (let i = Math.min(wanted, maxCut) - 1; i >= 1; i--) if (isBoundary(i)) return i;
    if (pastMax) for (let i = maxCut + 1; i < recent.length; i++) if (isBoundary(i)) return i;
    return 0;
  }

  // How many of the oldest Turns to fold: enough that the new Summary (reserved at its cap) plus
  // the remaining Turns fit in compactTo, never the last keepTurns where a boundary allows.
  function foldCount(key, recent) {
    const maxFold = Math.max(0, recent.length - cfg.keepTurns);
    const target = cfg.tokenBudget * cfg.compactTo;
    let wanted = 1;
    while (wanted < maxFold && measure(key, cfg.summaryTokens, recent.slice(wanted)) > target) {
      wanted++;
    }
    return chooseCut(recent, wanted, maxFold, { pastMax: true });
  }

  // Drops the oldest Turns (never the last keepTurns) until Summary plus Turns fit the budget.
  function trimmedRecent(key, summary, recent) {
    if (tokensOf(key, summary, recent) <= cfg.tokenBudget) return recent;
    const maxCut = Math.max(0, recent.length - cfg.keepTurns);
    let wanted = 1;
    while (wanted < maxCut && tokensOf(key, summary, recent.slice(wanted)) > cfg.tokenBudget) {
      wanted++;
    }
    return recent.slice(chooseCut(recent, wanted, maxCut));
  }

  async function compactOnce(key, { requestId, commandName }) {
    const record = await store.get(key);
    if (!record) return;
    const before = tokensOf(key, record.summary ?? "", record.recent);
    if (before <= cfg.tokenBudget * cfg.compactAt) return;
    const folded = foldCount(key, record.recent);
    if (folded === 0) return;

    let next = null;
    let outcome = "failed";
    let errorType;
    try {
      const { text } = await generate({
        requestId,
        commandName,
        googleSearch: false,
        systemInstruction: SUMMARIZER_INSTRUCTION,
        turns: [
          { role: "user", text: summarizerPrompt(record.summary, record.recent.slice(0, folded)) },
        ],
      });
      if (!text?.trim())
        throw Object.assign(new Error("empty summary"), { errorType: "empty_summary" });
      next = { ...record, summary: text.trim(), recent: record.recent.slice(folded) };
      outcome = "summarized";
    } catch (error) {
      errorType = errorTypeOf(error);
      if (before > cfg.tokenBudget) {
        next = { ...record, recent: record.recent.slice(folded) };
        outcome = "trimmed";
      }
    }

    let turnsFolded = next ? folded : 0;
    if (next) {
      const kept = trimmedRecent(key, next.summary ?? "", next.recent);
      if (kept.length < next.recent.length) {
        turnsFolded += next.recent.length - kept.length;
        next = { ...next, recent: kept };
        outcome = "trimmed";
      }
    }

    // Watermark: a changed version means the Conversation moved on while we were summarizing.
    if (next && (await store.get(key))?.version !== record.version) {
      next = null;
      turnsFolded = 0;
      outcome = "failed";
      errorType = "conflict";
    }
    if (next) await store.put(key, next);

    const after = next ? tokensOf(key, next.summary ?? "", next.recent) : before;
    logEvent("ai_compaction", {
      requestId,
      commandName,
      turnsFolded,
      tokensBefore: before,
      tokensAfter: after,
      outcome,
      ...(errorType ? { errorType } : {}),
    });
  }

  function compact(key, context) {
    return enqueue(key, () => compactOnce(key, context)).catch((error) =>
      logEvent("ai_compaction", {
        requestId: context.requestId,
        commandName: context.commandName,
        outcome: "failed",
        errorType: errorTypeOf(error),
      }),
    );
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
    const userText = text === "" ? `Halo, ${titleCase(scope.commandName)}!` : text;
    const key = keyFor(scope);
    return enqueue(key, async () => {
      const at = now();
      sweepIfDue(at);
      const conversation = await load(key, at, scope.commandName);

      const memberTurn = { role: "user", text: `from ${speaker}: ${userText}` };
      const sentTurns = [...conversation.recent, memberTurn];
      const systemInstruction = buildSystemInstruction(persona, conversation.summary);
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
      if (tokensOf(key, conversation.summary, recent) > cfg.tokenBudget * cfg.compactAt) {
        compact(key, {
          requestId: context?.requestId,
          commandName: scope.commandName,
        });
      }
      return { kind: "reply", text: reply };
    });
  }

  return { respond, reset };
}
