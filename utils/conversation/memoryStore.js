/**
 * In-memory conversation store (for tests). Same async interface as the
 * Postgres store: get / put / delete / keys.
 */
export function createMemoryStore() {
  const records = new Map();
  return {
    get: async (key) => (records.has(key) ? structuredClone(records.get(key)) : null),
    put: async (key, record) => {
      const version = (records.get(key)?.version ?? 0) + 1;
      records.set(key, { ...structuredClone(record), version });
    },
    delete: async (key) => {
      records.delete(key);
    },
    keys: async () => [...records.keys()],
  };
}
