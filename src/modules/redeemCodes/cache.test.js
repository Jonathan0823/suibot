import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCodeStore } from "./cache.js";

const games = ["gi", "hsr", "zzz", "wuwa", "endfield"];

describe("code store", () => {
  let prisma;
  let store;

  beforeEach(() => {
    prisma = {
      scrapedCode: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({}),
      },
    };
    store = createCodeStore({ prisma, games });
  });

  it("loads active codes into memory once", async () => {
    prisma.scrapedCode.findMany.mockResolvedValue([
      { game: "gi", code: "ABC123" },
      { game: "wuwa", code: "WUWA01" },
    ]);

    await store.ensureLoaded();
    await store.ensureLoaded();

    expect(prisma.scrapedCode.findMany).toHaveBeenCalledTimes(1);
    expect(store.getCached("gi")).toEqual(["ABC123"]);
  });

  it("filters codes already in the cache", async () => {
    prisma.scrapedCode.findMany.mockResolvedValue([{ game: "gi", code: "ABC123" }]);
    await store.ensureLoaded();

    expect(store.filterNew("gi", [{ code: "ABC123" }, { code: "NEW999" }])).toEqual([
      { code: "NEW999" },
    ]);
  });

  it("caps cached codes per game", async () => {
    await store.ensureLoaded();
    await store.save(
      "gi",
      Array.from({ length: 205 }, (_, i) => ({ code: `CODE${i}`, rewards: "x" })),
    );

    const cached = store.getCached("gi");
    expect(cached).toHaveLength(200);
    expect(cached.includes("CODE0")).toBe(false);
    expect(cached.includes("CODE204")).toBe(true);
  });

  it("adds saved codes to the cache and removes expired codes", async () => {
    await store.ensureLoaded();

    await store.save("gi", [{ code: "NEW1", rewards: "x" }]);
    expect(store.getCached("gi")).toEqual(["NEW1"]);

    await store.markExpired("gi", ["NEW1"]);
    expect(store.getCached("gi")).toEqual([]);
    expect(prisma.scrapedCode.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.scrapedCode.updateMany).toHaveBeenCalledTimes(1);
  });

  it("revalidates cache misses against the database before treating them as new", async () => {
    await store.ensureLoaded();
    prisma.scrapedCode.findMany.mockResolvedValue([{ code: "OLD999" }]);

    const result = await store.revalidateCacheMisses("gi", [
      { code: "OLD999" },
      { code: "NEW100" },
    ]);

    expect(prisma.scrapedCode.findMany).toHaveBeenCalledTimes(2);
    expect(result).toEqual([{ code: "NEW100" }]);
  });
});
