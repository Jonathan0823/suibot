import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  default: {
    userMemory: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import prisma from "../lib/prisma.js";
import { createPersistentMemory } from "../utils/memory/persistentMemory.js";

describe("persistentMemory", () => {
  it("uses the shared prisma singleton", async () => {
    const memory = createPersistentMemory();

    prisma.userMemory.findMany.mockResolvedValue([]);

    await memory.get("user", "guild", "channel");

    expect(prisma.userMemory.findMany).toHaveBeenCalledTimes(1);
  });
});
