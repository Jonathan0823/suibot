import { describe, expect, it, vi } from "vitest";
import {
  createEnkaService,
  startCacheUpdater,
  toGenshinProfile,
  toStarRailProfile,
} from "./enkaClient.js";

const t = (en) => ({ get: (lang) => (lang === "en" ? en : "") });

const srChar = (id, name, level, element, eidolons) => ({
  characterData: { id, name: t(name), combatType: { name: t(element) } },
  level,
  eidolons,
});

describe("toStarRailProfile", () => {
  const user = {
    uid: 808791484,
    nickname: "lynz",
    level: 70,
    equilibriumLevel: 6,
    achievementCount: 1477,
    icon: { icon: { url: "https://img.test/icon.png" } },
    supportCharacters: [srChar(1407, "Castorice", 80, "Quantum", 2)],
    starfaringCompanions: [
      srChar(1407, "Castorice", 80, "Quantum", 2),
      srChar(1006, "Silver Wolf LV.<unbreak>999</unbreak>", 80, "Imaginary", 4),
    ],
  };

  it("maps the player and support characters, then starfaring companions, without repeats", () => {
    expect(toStarRailProfile(user)).toEqual({
      uid: "808791484",
      player: {
        username: "lynz",
        level: 70,
        equilibriumLevel: 6,
        recordInfo: { achievementCount: 1477 },
        profilePictureUrl: "https://img.test/icon.png",
      },
      characters: [
        { name: "Castorice", level: 80, element: "Quantum", eidolons: 2 },
        { name: "Silver Wolf LV.999", level: 80, element: "Imaginary", eidolons: 4 },
      ],
    });
  });

  it("returns no characters when the showcase is hidden", () => {
    expect(toStarRailProfile({ uid: 1 }).characters).toEqual([]);
  });
});

describe("toGenshinProfile", () => {
  const user = (overrides) => ({
    uid: 825436941,
    nickname: "T",
    level: 60,
    worldLevel: 9,
    achievements: 1180,
    spiralAbyss: { floor: 12, chamber: 3, stars: 36 },
    showConstellationPreview: true,
    profilePicture: { icon: { url: "https://img.test/pfp.png" } },
    charactersPreview: [
      {
        costume: { characterId: 10000089 },
        level: 90,
        element: { name: t("Hydro") },
        constellation: null,
      },
      {
        costume: { characterId: 10000046 },
        level: 90,
        element: { name: t("Pyro") },
        constellation: 2,
      },
    ],
    ...overrides,
  });
  const names = { 10000089: "Furina", 10000046: "Hu Tao" };

  it("maps the player, Abyss and showcase, treating a missing constellation as C0", () => {
    expect(toGenshinProfile(user(), (id) => names[id])).toEqual({
      uid: "825436941",
      player: {
        username: "T",
        levels: { world: 9, rank: 60 },
        achievements: 1180,
        abyss: { floor: 12, chamber: 3, stars: 36 },
        publicConstellations: true,
        profilePictureUrl: "https://img.test/pfp.png",
        showcase: [
          { name: "Furina", level: 90, element: "Hydro", constellations: 0 },
          { name: "Hu Tao", level: 90, element: "Pyro", constellations: 2 },
        ],
      },
    });
  });

  it("leaves constellations out when the player hides them", () => {
    const profile = toGenshinProfile(user({ showConstellationPreview: false }), (id) => names[id]);
    expect(profile.player.publicConstellations).toBe(false);
    expect(profile.player.showcase.map((c) => c.constellations)).toEqual([undefined, undefined]);
  });

  it("omits the Abyss when there is none", () => {
    expect(toGenshinProfile(user({ spiralAbyss: null }), () => "X").player.abyss).toBeUndefined();
  });
});

describe("createEnkaService", () => {
  const clients = () => ({
    genshin: {
      fetchUser: vi.fn().mockResolvedValue({ uid: 1, charactersPreview: [] }),
      getCharacterById: vi.fn(),
    },
    starrail: { fetchUser: vi.fn().mockResolvedValue({ uid: 2 }) },
    autoUpdate: false,
  });

  it("fetches from the client for the game", async () => {
    const deps = clients();
    const enka = createEnkaService(deps);
    expect((await enka.getPlayer("starrail", "2")).uid).toBe("2");
    expect(deps.starrail.fetchUser).toHaveBeenCalledWith("2");
    expect((await enka.getPlayer("genshin", "1")).uid).toBe("1");
    expect(deps.genshin.fetchUser).toHaveBeenCalledWith("1");
  });

  it("propagates an Enka failure", async () => {
    const deps = clients();
    deps.starrail.fetchUser.mockRejectedValue(new Error("404"));
    await expect(createEnkaService(deps).getPlayer("starrail", "1")).rejects.toThrow("404");
  });

  it("rejects an unknown game", async () => {
    await expect(createEnkaService(clients()).getPlayer("zzz", "1")).rejects.toThrow();
  });
});

describe("startCacheUpdater", () => {
  const log = () => ({ info: vi.fn(), error: vi.fn() });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("updates now, refreshes game data when an update lands, and logs it", async () => {
    const assets = {
      updateContents: vi.fn(async ({ onUpdateStart, onUpdateEnd }) => {
        await onUpdateStart();
        await onUpdateEnd();
      }),
      refreshAllData: vi.fn(),
    };
    const logger = log();
    const stop = startCacheUpdater("Star Rail", { cachedAssetsManager: assets }, { log: logger });
    await flush();
    stop();
    expect(assets.updateContents).toHaveBeenCalledTimes(1);
    expect(assets.refreshAllData).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("[Enka] Star Rail game data updated");
  });

  it("logs a failed update instead of leaving an unhandled rejection", async () => {
    const assets = {
      updateContents: vi.fn().mockRejectedValue(new Error("rate limited")),
      refreshAllData: vi.fn(),
    };
    const logger = log();
    const stop = startCacheUpdater("Genshin", { cachedAssetsManager: assets }, { log: logger });
    await flush();
    stop();
    expect(logger.error).toHaveBeenCalledWith(
      "[Enka] Genshin game data update failed:",
      expect.any(Error),
    );
    expect(assets.refreshAllData).not.toHaveBeenCalled();
  });

  it("checks again every interval but never runs two updates at once", async () => {
    vi.useFakeTimers();
    try {
      let finish;
      const assets = {
        updateContents: vi.fn(() => new Promise((resolve) => (finish = resolve))),
        refreshAllData: vi.fn(),
      };
      const stop = startCacheUpdater(
        "Genshin",
        { cachedAssetsManager: assets },
        { log: log(), intervalMs: 1000 },
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(assets.updateContents).toHaveBeenCalledTimes(1);
      finish();
      await vi.advanceTimersByTimeAsync(1000);
      expect(assets.updateContents).toHaveBeenCalledTimes(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
