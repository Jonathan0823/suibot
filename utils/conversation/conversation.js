import { titleCase } from "../../helper/titleCase.js";

const DEFAULTS = {
  recentWindow: 10,
  promptTurns: 8,
  summaryThreshold: 10,
};

const RULES = [
  "The timezone is Asia/Jakarta or UTC +7.",
  "Don't reveal conversation context or internal notes in your response.",
].join(" ");

function keyFor({ guildId, channelId, userId, commandName }) {
  return `${guildId}:${channelId}:${userId}:${commandName}`;
}

function summarize(turns) {
  const first = turns[0];
  return `[Previous ${turns.length} exchanges: started with "${first.sender}: ${first.content.slice(0, 50)}..."]`;
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

  function load(key) {
    const record = store.get(key);
    return {
      recent: record?.recent ?? [],
      summary: typeof record?.summary === "string" ? record.summary : "",
    };
  }

  function buildContents({ recent, summary }, speaker, text) {
    const parts = [];
    if (summary) parts.push(`[Session Summary] ${summary}`);
    if (recent.length > 0) {
      const lines = recent
        .slice(-cfg.promptTurns)
        .map((turn) => `${turn.sender}: ${turn.content}`)
        .join("\n");
      parts.push(`[Recent Conversation]\n${lines}`);
    }
    parts.push(`from ${speaker}: ${text}`);
    return parts.join("\n\n");
  }

  function reset(scope) {
    store.delete(keyFor(scope));
    return { kind: "reset" };
  }

  async function respond({ scope, speaker, text, persona, context }) {
    if (text.toLowerCase() === "reset") return reset(scope);
    const message = text === "" ? `Halo, ${titleCase(scope.commandName)}!` : text;
    const key = keyFor(scope);
    const conversation = load(key);

    const reply = await generate({
      ...context,
      contents: buildContents(conversation, speaker, message),
      systemInstruction: `${persona} ${RULES}`,
    });

    const recent = [
      ...conversation.recent,
      { sender: speaker, content: message },
      { sender: scope.commandName, content: reply },
    ].slice(-cfg.recentWindow);
    const summary = recent.length >= cfg.summaryThreshold ? summarize(recent) : "";
    store.put(key, { recent, summary, lastActive: now() });
    return { kind: "reply", text: reply };
  }

  return { respond, reset };
}
