export const IDLE_EXPIRY_MS = 24 * 60 * 60 * 1000;

// Records written before Turns carried a role stored { sender, content }.
export function normalizeTurn(turn, persona) {
  if (turn.role) return turn;
  return turn.sender === persona
    ? { role: "model", text: turn.content }
    : { role: "user", text: `from ${turn.sender}: ${turn.content}` };
}

/** A Conversation key is "guildId:channelId:userId:persona". */
export function buildKey({ guildId, channelId, userId, persona }) {
  return `${guildId}:${channelId}:${userId}:${persona}`;
}

export function parseKey(key) {
  const [guildId, channelId, userId, ...persona] = key.split(":");
  return { guildId, channelId, userId, persona: persona.join(":") };
}
