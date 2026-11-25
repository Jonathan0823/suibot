import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const isRuntimeModule = (file) => file.endsWith(".js") && !file.endsWith(".test.js");

/**
 * Import the default export of every runtime .js file in a directory.
 * @param {string} dir absolute directory path
 * @returns {Promise<any[]>}
 */
export async function loadDirectory(dir) {
  const files = fs.readdirSync(dir).filter(isRuntimeModule);
  const items = [];
  for (const file of files) {
    const module = await import(pathToFileURL(path.join(dir, file)).href);
    items.push(module.default);
  }
  return items;
}

/** Attach loaded event modules to the client. */
export function registerEvents(client, events) {
  for (const event of events) {
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
  }
}
