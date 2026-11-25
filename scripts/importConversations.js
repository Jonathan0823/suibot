import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import prisma from "../src/lib/prisma.js";
import { importLegacyConversations } from "../src/modules/conversation/importLegacy.js";
import { createPostgresStore } from "../src/modules/conversation/postgresStore.js";

// Usage: node scripts/importConversations.js [path/to/memory.json]
const file = path.resolve(process.argv[2] ?? "data/memory.json");

try {
  const records = JSON.parse(fs.readFileSync(file, "utf-8"));
  const result = await importLegacyConversations({
    records,
    store: createPostgresStore({ prisma }),
  });
  console.log(`Imported ${result.imported} Conversations, skipped ${result.skipped}.`);
} finally {
  await prisma.$disconnect();
}
