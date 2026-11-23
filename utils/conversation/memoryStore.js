/**
 * In-memory conversation store. Same interface as the file adapter:
 * get / put / delete / keys.
 */
export function createMemoryStore() {
  const records = new Map();
  return {
    get: (key) => (records.has(key) ? structuredClone(records.get(key)) : null),
    put: (key, record) => {
      records.set(key, structuredClone(record));
    },
    delete: (key) => {
      records.delete(key);
    },
    keys: () => [...records.keys()],
  };
}
