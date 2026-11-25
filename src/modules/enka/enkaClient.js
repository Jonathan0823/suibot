import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { EnkaClient } from "enka-network-api";
import { StarRail } from "starrail.js";

const LANGUAGE = "en";
const CACHE_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_TIMEOUT_MS = 15 * 60 * 1000;
const UPDATE_SCRIPT = fileURLToPath(new URL("./updateGameData.js", import.meta.url));
const GAME_LABELS = { genshin: "Genshin", starrail: "Star Rail" };
const UID_PATTERN = /^\d+$/;

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
 * Updates one game's data in a child process (updateGameData.js) and reports whether new data
 * landed. Rejects when the child fails, crashes or runs past timeoutMs.
 * @returns {Promise<{updated: boolean}>}
 */
export function runUpdateInChild(
  game,
  { timeoutMs = UPDATE_TIMEOUT_MS, script = UPDATE_SCRIPT } = {},
) {
  return new Promise((resolve, reject) => {
    const child = fork(script, [game], {
      // Don't pass the bot's own Node flags (--inspect, --watch, ...) to the updater.
      execArgv: [],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    let updated = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`game data update timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.on("message", (message) => {
      if (message?.updated) updated = true;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ updated });
      else reject(new Error(`game data update exited with ${signal ?? `code ${code}`}`));
    });
  });
}

/**
 * Checks for new game data now and then every interval, so new characters appear without a
 * package release. Each check runs in a child process: the libraries' own updater leaves
 * failures unhandled (an unzip error can crash the process) and, after a failed download,
 * refuses every later update until restart. When new data lands, this process reloads it.
 * @param {"genshin" | "starrail"} game
 * @returns {() => void} stops the updater
 */
export function startCacheUpdater(
  game,
  client,
  { log = console, intervalMs = CACHE_UPDATE_INTERVAL_MS, runUpdate = runUpdateInChild } = {},
) {
  const label = GAME_LABELS[game];
  let updating = false;
  async function update() {
    if (updating) return;
    updating = true;
    try {
      const { updated } = await runUpdate(game);
      if (updated) {
        client.cachedAssetsManager.refreshAllData();
        log.info(`[Enka] ${label} game data updated`);
      }
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
    startCacheUpdater("genshin", genshin, { log });
    startCacheUpdater("starrail", starrail, { log });
  }

  return {
    /** @param {"genshin" | "starrail"} game */
    async getPlayer(game, uid) {
      // The libraries reject a non-numeric UID with a plain Error; name it like Enka's own.
      if (!UID_PATTERN.test(String(uid ?? "").trim())) {
        throw Object.assign(new Error(`Invalid UID format. (${uid} provided.)`), {
          name: "InvalidUidFormatError",
        });
      }
      uid = String(uid).trim();
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
