import { EnkaClient } from "enka-network-api";
import { StarRail } from "starrail.js";

const LANGUAGE = "en";
const CACHE_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

const text = (textAssets) => {
  try {
    // Game text can carry markup such as <unbreak>999</unbreak>.
    return textAssets?.get(LANGUAGE)?.replace(/<[^>]*>/g, "") || undefined;
  } catch {
    return undefined;
  }
};

/**
 * Plain Player Profile from a starrail.js StarRailUser. Showcase = support characters, then
 * starfaring companions, without repeats.
 */
export function toStarRailProfile(user) {
  const seen = new Set();
  const characters = [...(user.supportCharacters ?? []), ...(user.starfaringCompanions ?? [])]
    .filter((c) => {
      const id = c?.characterData?.id;
      if (id == null || seen.has(id)) return id == null;
      seen.add(id);
      return true;
    })
    .map((c) => ({
      name: text(c.characterData?.name),
      level: c.level,
      element: text(c.characterData?.combatType?.name),
      eidolons: c.eidolons,
    }));
  return {
    uid: String(user.uid),
    player: {
      username: user.nickname,
      level: user.level,
      equilibriumLevel: user.equilibriumLevel,
      recordInfo: { achievementCount: user.achievementCount },
      profilePictureUrl: user.icon?.icon?.url,
    },
    characters,
  };
}

/**
 * Plain Player Profile from an enka-network-api User.
 * @param {(characterId: number) => string | undefined} characterName
 */
export function toGenshinProfile(user, characterName) {
  const publicConstellations = user.showConstellationPreview !== false;
  const abyss = user.spiralAbyss;
  return {
    uid: String(user.uid),
    player: {
      username: user.nickname,
      levels: { world: user.worldLevel, rank: user.level },
      achievements: user.achievements,
      abyss: abyss ? { floor: abyss.floor, chamber: abyss.chamber, stars: abyss.stars } : undefined,
      publicConstellations,
      profilePictureUrl: user.profilePicture?.icon?.url,
      showcase: (user.charactersPreview ?? []).map((c) => ({
        name: characterName(c.costume?.characterId),
        level: c.level,
        element: text(c.element?.name),
        // Enka leaves C0 as null when constellations are public.
        constellations: publicConstellations ? (c.constellation ?? 0) : undefined,
      })),
    },
  };
}

let defaultService;

/** The process-wide Enka service, created on first use so imports stay side-effect free. */
export function getEnkaService() {
  defaultService ??= createEnkaService();
  return defaultService;
}

/**
 * Checks for new game data now and then every interval, so new characters appear without a
 * package release. The libraries' own activateAutoCacheUpdater() does not await its updates,
 * so a failed download (GitHub down, rate limit) becomes an unhandled rejection; this loop
 * catches it and keeps the old data.
 * @returns {() => void} stops the updater
 */
export function startCacheUpdater(
  label,
  client,
  { log = console, intervalMs = CACHE_UPDATE_INTERVAL_MS } = {},
) {
  const assets = client.cachedAssetsManager;
  let updating = false;
  async function update() {
    if (updating) return;
    updating = true;
    try {
      await assets.updateContents({
        onUpdateStart: async () => log.info(`[Enka] Updating ${label} game data...`),
        onUpdateEnd: async () => {
          assets.refreshAllData();
          log.info(`[Enka] ${label} game data updated`);
        },
      });
    } catch (error) {
      log.error(`[Enka] ${label} game data update failed:`, error);
    } finally {
      updating = false;
    }
  }
  update();
  const timer = setInterval(update, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** One shared Enka.network client per game, with game data kept current (startCacheUpdater). */
export function createEnkaService({
  genshin = new EnkaClient({ showFetchCacheLog: false }),
  starrail = new StarRail({ showFetchCacheLog: false }),
  autoUpdate = true,
  log = console,
} = {}) {
  if (autoUpdate) {
    startCacheUpdater("Genshin", genshin, { log });
    startCacheUpdater("Star Rail", starrail, { log });
  }

  return {
    /** @param {"genshin" | "starrail"} game */
    async getPlayer(game, uid) {
      if (game === "starrail") return toStarRailProfile(await starrail.fetchUser(uid));
      if (game === "genshin") {
        const user = await genshin.fetchUser(uid);
        return toGenshinProfile(user, (id) => {
          try {
            return text(genshin.getCharacterById(id)?.name);
          } catch {
            return undefined;
          }
        });
      }
      throw new Error("unknown game");
    },
  };
}
