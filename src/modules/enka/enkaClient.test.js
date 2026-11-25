import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  createEnkaService,
  runUpdateInChild,
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

describe("createEnkaService UID check", () => {
  const deps = () => ({
    genshin: { fetchUser: vi.fn(), getCharacterById: vi.fn() },
    starrail: { fetchUser: vi.fn().mockResolvedValue({ uid: 808791484 }) },
    autoUpdate: false,
  });

  it.each(["abc", "", "12a", undefined])(
    "rejects %j as InvalidUidFormatError without fetching",
    async (uid) => {
      const d = deps();
      await expect(createEnkaService(d).getPlayer("starrail", uid)).rejects.toMatchObject({
        name: "InvalidUidFormatError",
      });
      expect(d.starrail.fetchUser).not.toHaveBeenCalled();
    },
  );

  it("trims a numeric UID before fetching", async () => {
    const d = deps();
    await createEnkaService(d).getPlayer("starrail", " 808791484 ");
    expect(d.starrail.fetchUser).toHaveBeenCalledWith("808791484");
  });
});

describe("startCacheUpdater", () => {
  const log = () => ({ info: vi.fn(), error: vi.fn() });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const client = () => ({ cachedAssetsManager: { refreshAllData: vi.fn() } });

  it("updates now and reloads game data when the update brought new data", async () => {
    const c = client();
    const logger = log();
    const runUpdate = vi.fn().mockResolvedValue({ updated: true });
    const stop = startCacheUpdater("starrail", c, { log: logger, runUpdate });
    await flush();
    stop();
    expect(runUpdate).toHaveBeenCalledWith("starrail");
    expect(c.cachedAssetsManager.refreshAllData).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("[Enka] Star Rail game data updated");
  });

  it("does not reload when nothing changed", async () => {
    const c = client();
    const stop = startCacheUpdater("genshin", c, {
      log: log(),
      runUpdate: vi.fn().mockResolvedValue({ updated: false }),
    });
    await flush();
    stop();
    expect(c.cachedAssetsManager.refreshAllData).not.toHaveBeenCalled();
  });

  it("logs a failed update instead of crashing, and tries again next interval", async () => {
    vi.useFakeTimers();
    try {
      const c = client();
      const logger = log();
      const runUpdate = vi
        .fn()
        .mockRejectedValueOnce(new Error("exited with code 1"))
        .mockResolvedValue({ updated: true });
      const stop = startCacheUpdater("genshin", c, { log: logger, runUpdate, intervalMs: 1000 });
      await vi.advanceTimersByTimeAsync(0);
      expect(logger.error).toHaveBeenCalledWith(
        "[Enka] Genshin game data update failed:",
        expect.any(Error),
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(runUpdate).toHaveBeenCalledTimes(2);
      expect(c.cachedAssetsManager.refreshAllData).toHaveBeenCalledTimes(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never runs two updates at once", async () => {
    vi.useFakeTimers();
    try {
      let finish;
      const runUpdate = vi.fn(() => new Promise((resolve) => (finish = resolve)));
      const stop = startCacheUpdater("genshin", client(), {
        log: log(),
        runUpdate,
        intervalMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(runUpdate).toHaveBeenCalledTimes(1);
      finish({ updated: false });
      await vi.advanceTimersByTimeAsync(1000);
      expect(runUpdate).toHaveBeenCalledTimes(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("runUpdateInChild", () => {
  const scriptDir = mkdtempSync(join(tmpdir(), "enka-updater-"));
  afterAll(() => rmSync(scriptDir, { recursive: true, force: true }));
  const script = (name, body) => {
    const path = join(scriptDir, name);
    writeFileSync(path, body);
    return path;
  };

  it("reports that new data landed", async () => {
    const path = script("ok.mjs", "process.send({ updated: true }); process.exit(0);");
    await expect(runUpdateInChild("genshin", { script: path })).resolves.toEqual({ updated: true });
  });

  it("rejects, without crashing this process, when the child throws from a callback", async () => {
    const path = script("crash.mjs", 'setTimeout(() => { throw new Error("ENOSPC"); }, 0);');
    await expect(runUpdateInChild("genshin", { script: path })).rejects.toThrow(
      /exited with code 1/,
    );
  });

  it("kills a child that runs past the timeout", async () => {
    const path = script("hang.mjs", "setInterval(() => {}, 1000);");
    await expect(runUpdateInChild("genshin", { script: path, timeoutMs: 200 })).rejects.toThrow(
      /timed out/,
    );
  });
});
