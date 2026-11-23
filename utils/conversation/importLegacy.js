const FACT_MARK = ":fact:";
const PLACEHOLDER_SUMMARY = /^\[Previous \d+ exchanges/;
const IDLE_EXPIRY_MS = 24 * 60 * 60 * 1000;

// Turns written before they carried a role stored { sender, content }.
function normalizeTurn(turn, persona) {
  if (turn.role) return turn;
  return turn.sender === persona
    ? { role: "model", text: turn.content }
    : { role: "user", text: `from ${turn.sender}: ${turn.content}` };
}

function legacySummary(record) {
  const summary = typeof record.summary === "string" ? record.summary : record.summary?.summary;
  return typeof summary === "string" && !PLACEHOLDER_SUMMARY.test(summary) ? summary : "";
}

/**
 * Import Conversations from the legacy data/memory.json records into a store.
 * Safe to run more than once: Conversations already in the store are left alone.
 * @param {object} deps
 * @param {Record<string, object>} deps.records parsed memory.json
 * @param {{get, put}} deps.store target conversation store
 * @param {() => number} [deps.now] clock
 * @returns {Promise<{imported: number, skipped: number}>}
 */
export async function importLegacyConversations({ records, store, now = Date.now }) {
  const at = now();
  let imported = 0;
  let skipped = 0;

  for (const [key, record] of Object.entries(records)) {
    const lastActive =
      typeof record?.lastActive === "number" ? record.lastActive : record?.lastSaved;
    const idle = typeof lastActive === "number" && at - lastActive > IDLE_EXPIRY_MS;
    if (key.includes(FACT_MARK) || !record || typeof record !== "object" || idle) {
      skipped++;
      continue;
    }
    if (await store.get(key)) {
      skipped++;
      continue;
    }
    const persona = key.slice(key.lastIndexOf(":") + 1);
    await store.put(key, {
      recent: (Array.isArray(record.recent) ? record.recent : []).map((turn) =>
        normalizeTurn(turn, persona),
      ),
      summary: legacySummary(record),
      lastActive: typeof lastActive === "number" ? lastActive : undefined,
    });
    imported++;
  }
  return { imported, skipped };
}
