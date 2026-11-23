import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Same save file as the legacy memory storage: <repo>/data/memory.json
const DEFAULT_STORAGE_PATH = path.resolve(here, "../../data/memory.json");
const FACT_MARK = ":fact:";

/**
 * Map a legacy or current record onto the current shape:
 * { recent, summary (string), lastActive (ms) }.
 */
function normalizeRecord(record) {
  const summary =
    typeof record.summary === "string" ? record.summary : (record.summary?.summary ?? "");
  const lastActive =
    typeof record.lastActive === "number"
      ? record.lastActive
      : typeof record.lastSaved === "number"
        ? record.lastSaved
        : undefined;
  return {
    recent: Array.isArray(record.recent) ? record.recent : [],
    summary: typeof summary === "string" ? summary : "",
    lastActive,
  };
}

function readRecords(file) {
  if (!fs.existsSync(file)) return {};

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (error) {
    console.error("Conversation store load error, starting empty:", error);
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error("Conversation store load error, starting empty: unexpected file shape");
    return {};
  }

  const records = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key.includes(FACT_MARK) || !value || typeof value !== "object") continue;
    records[key] = normalizeRecord(value);
  }
  return records;
}

/**
 * File conversation store: the JSON save file is read at most once (lazily),
 * served from memory afterwards, and written once per put or delete.
 * @param {object} [options]
 * @param {string} [options.storagePath] save file location
 * @returns {{get, put, delete, keys}}
 */
export function createFileStore({ storagePath = DEFAULT_STORAGE_PATH } = {}) {
  let records = null;

  function load() {
    if (records === null) records = readRecords(storagePath);
    return records;
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(storagePath), { recursive: true });
      fs.writeFileSync(storagePath, JSON.stringify(records, null, 2), "utf-8");
    } catch (error) {
      console.error("Conversation store save error:", error);
    }
  }

  return {
    get(key) {
      const all = load();
      return Object.hasOwn(all, key) ? all[key] : null;
    },
    put(key, record) {
      load()[key] = normalizeRecord(record);
      save();
    },
    delete(key) {
      const all = load();
      if (!Object.hasOwn(all, key)) return;
      delete all[key];
      save();
    },
    keys() {
      return Object.keys(load());
    },
  };
}
