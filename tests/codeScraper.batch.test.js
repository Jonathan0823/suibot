import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma.js", () => ({
  default: {
    scrapedCode: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("../utils/codeScraper.js", async () => {
  const actual = await vi.importActual("../utils/codeScraper.js");
  return actual;
});

import prisma from "../lib/prisma.js";
import { addCodeToCache, ensureScrapedCodeCache, filterNewCodes, getCachedCodesForGame, markCodesExpired, revalidateCacheMisses, saveCodes } from "../utils/codeScraper.js";

describe("codeScraper batching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads active codes into memory once", async () => {
    prisma.scrapedCode.findMany.mockResolvedValue([
      { game: "gi", code: "ABC123" },
      { game: "wuwa", code: "WUWA01" },
    ]);

    await ensureScrapedCodeCache();

    expect(prisma.scrapedCode.findMany).toHaveBeenCalledTimes(1);
  });

  it("filters codes from a preloaded game set", async () => {
    const existing = new Map([["gi", new Set(["ABC123"])]]);

    const result = await filterNewCodes(
      "gi",
      [{ code: "ABC123" }, { code: "NEW999" }],
      existing,
    );

    expect(result).toEqual([{ code: "NEW999" }]);
  });

  it("caps cached codes per game", async () => {
    prisma.scrapedCode.findMany.mockResolvedValue([]);

    await ensureScrapedCodeCache();

    for (let i = 0; i < 205; i += 1) {
      addCodeToCache("gi", `CODE${i}`);
    }

    const cached = getCachedCodesForGame("gi");
    expect(cached).toHaveLength(200);
    expect(cached.includes("CODE0")).toBe(false);
    expect(cached.includes("CODE204")).toBe(true);
  });

  it("adds new saved codes to the cache and removes expired codes", async () => {
    prisma.scrapedCode.findMany.mockResolvedValue([]);
    prisma.scrapedCode.createMany.mockResolvedValue({});
    prisma.scrapedCode.updateMany.mockResolvedValue({});

    await ensureScrapedCodeCache();

    await saveCodes("gi", [{ code: "NEW1", rewards: "x" }]);
    await markCodesExpired("gi", ["NEW1"]);

    expect(prisma.scrapedCode.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.scrapedCode.updateMany).toHaveBeenCalledTimes(1);
  });

  it("revalidates cache misses against the database before treating them as new", async () => {
    prisma.scrapedCode.findMany.mockResolvedValue([{ code: "OLD999" }]);

    await ensureScrapedCodeCache();

    const result = await revalidateCacheMisses("gi", [
      { code: "OLD999" },
      { code: "NEW100" },
    ]);

    expect(prisma.scrapedCode.findMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ code: "NEW100" }]);
  });
});
