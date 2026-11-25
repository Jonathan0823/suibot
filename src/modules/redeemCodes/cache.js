const MAX_CODES_PER_GAME = 200;

/**
 * In-memory cache of active scraped codes, backed by the ScrapedCode table.
 * @param {{ prisma: any, games: string[] }} deps
 */
export function createCodeStore({ prisma, games }) {
  const cache = new Map();
  let loaded = false;

  const createGameCache = () => ({ set: new Set(), order: [] });

  function getGameCache(game) {
    if (!cache.has(game)) cache.set(game, createGameCache());
    return cache.get(game);
  }

  function addToCache(game, code) {
    const gameCache = getGameCache(game);
    if (gameCache.set.has(code)) return;

    gameCache.set.add(code);
    gameCache.order.push(code);

    while (gameCache.order.length > MAX_CODES_PER_GAME) {
      const oldest = gameCache.order.shift();
      if (oldest) gameCache.set.delete(oldest);
    }
  }

  function removeFromCache(game, code) {
    const gameCache = cache.get(game);
    if (!gameCache?.set.has(code)) return;

    gameCache.set.delete(code);
    gameCache.order = gameCache.order.filter((entry) => entry !== code);
  }

  function getCached(game) {
    const gameCache = cache.get(game);
    return gameCache ? [...gameCache.order] : [];
  }

  async function ensureLoaded() {
    if (loaded) return;

    for (const game of games) cache.set(game, createGameCache());

    const activeCodes = await prisma.scrapedCode.findMany({
      where: { status: "active" },
      select: { code: true, game: true },
      orderBy: { createdAt: "asc" },
    });

    for (const { game, code } of activeCodes) addToCache(game, code);

    loaded = true;
  }

  /** Drop codes already in the cache. */
  function filterNew(game, codes) {
    const known = getGameCache(game).set;
    return codes.filter((c) => !known.has(c.code));
  }

  /** Check cache misses against the database before treating them as new. */
  async function revalidateCacheMisses(game, codes) {
    if (codes.length === 0) return [];

    const cachedSet = getGameCache(game).set;
    const cacheMisses = codes.filter((code) => !cachedSet.has(code.code));

    if (cacheMisses.length === 0) return codes;

    const existingCodes = await prisma.scrapedCode.findMany({
      where: {
        game,
        status: "active",
        code: { in: cacheMisses.map((code) => code.code) },
      },
      select: { code: true },
    });

    const existingSet = new Set(existingCodes.map((entry) => entry.code));
    for (const { code } of existingCodes) addToCache(game, code);

    return codes.filter((code) => !cachedSet.has(code.code) && !existingSet.has(code.code));
  }

  async function save(game, codes) {
    if (codes.length === 0) return;

    await prisma.scrapedCode.createMany({
      data: codes.map((c) => ({
        code: c.code,
        game,
        rewards: c.rewards,
        status: "active",
      })),
      skipDuplicates: true,
    });

    for (const { code } of codes) addToCache(game, code);
  }

  async function markExpired(game, codes) {
    if (codes.length === 0) return;

    await prisma.scrapedCode.updateMany({
      where: { game, code: { in: codes } },
      data: { status: "expired" },
    });

    for (const code of codes) removeFromCache(game, code);
  }

  return {
    ensureLoaded,
    getCached,
    filterNew,
    revalidateCacheMisses,
    save,
    markExpired,
  };
}
