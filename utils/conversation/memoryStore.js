/**
 * In-memory conversation store (for tests). Same async interface as the
 * Postgres store: get / put / delete / keys.
 */
export function createMemoryStore() {
  const records = new Map();
  return {
    get: async (key) => (records.has(key) ? structuredClone(records.get(key)) : null),
    put: async (key, record) => {
      records.set(key, structuredClone(record));
    },
    delete: async (key) => {
      records.delete(key);
    },
    keys: async () => [...records.keys()],
  };
}
