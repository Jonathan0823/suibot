/**
 * Memory Module
 * 3-layer memory architecture: recent + summary + persistent
 */

export { createRecentMemory } from "./recentMemory.js";
export { createSummaryMemory } from "./summaryMemory.js";
export { createPersistentMemory } from "./persistentMemory.js";

export const MEMORY_CONFIG = {
  recentTurns: 10,
  summaryThreshold: 10,
  ttlDays: 30,
};