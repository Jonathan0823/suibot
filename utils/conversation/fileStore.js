import { createFileStorage } from "../memory/storage.js";

/**
 * Temporary file adapter over today's JSON save file (replaced in a later ticket).
 * Same interface as the in-memory store: get / put / delete / keys.
 */
export function createFileStore(options) {
  const storage = createFileStorage(options);
  const isFact = (key) => key.includes(":fact:");
  return {
    get: (key) => (isFact(key) ? null : storage.get(key)),
    put: (key, record) => storage.set(key, record),
    delete: (key) => storage.delete(key),
    keys: () => storage.keys().filter((key) => !isFact(key)),
  };
}
