/**
 * File-based Storage
 * Simple JSON file storage for memory persistence.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_STORAGE_PATH = path.join(__dirname, "../../data/memory.json");

/**
 * Create a file-based storage
 * @param {object} config - Configuration
 * @param {string} config.storagePath - Path to storage file
 * @returns {object} Storage functions
 */
export function createFileStorage({ storagePath = DEFAULT_STORAGE_PATH } = {}) {
  // Ensure data directory exists
  const dir = path.dirname(storagePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Load data from file
  function loadData() {
    try {
      if (fs.existsSync(storagePath)) {
        const content = fs.readFileSync(storagePath, "utf-8");
        return JSON.parse(content);
      }
    } catch (error) {
      console.error("FileStorage load error:", error);
    }
    return {};
  }

  // Save data to file
  function saveData(data) {
    try {
      fs.writeFileSync(storagePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (error) {
      console.error("FileStorage save error:", error);
    }
  }

  return {
    /**
     * Get a value by key
     * @param {string} key - Storage key
     * @returns {any} Stored value or null
     */
    get(key) {
      const data = loadData();
      return data[key] || null;
    },

    /**
     * Set a value
     * @param {string} key - Storage key
     * @param {any} value - Value to store
     */
    set(key, value) {
      const data = loadData();
      data[key] = value;
      saveData(data);
    },

    /**
     * Delete a key
     * @param {string} key - Storage key
     */
    delete(key) {
      const data = loadData();
      delete data[key];
      saveData(data);
    },

    /**
     * Get all keys
     * @returns {string[]} Array of keys
     */
    keys() {
      const data = loadData();
      return Object.keys(data);
    },

    /**
     * Check if key exists
     * @param {string} key - Storage key
     * @returns {boolean}
     */
    has(key) {
      const data = loadData();
      return key in data;
    },

    /**
     * Clear all data
     */
    clear() {
      saveData({});
    },

    /**
     * Get entire data object
     * @returns {object} All stored data
     */
    all() {
      return loadData();
    },
  };
}

export default { createFileStorage };