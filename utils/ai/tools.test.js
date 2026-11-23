import { describe, expect, it, vi } from "vitest";
import { createTools } from "./tools.js";

function toolsWith(deps = {}) {
  const tools = createTools({
    search: vi.fn(),
    getCodes: vi.fn(),
    getPlayer: vi.fn(),
    now: () => new Date("2026-01-01T00:00:00Z"),
    ...deps,
  });
  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
}

describe("web_search", () => {
  it("returns the answer and source URLs", async () => {
    const search = vi.fn().mockResolvedValue({ text: "Sunny", sources: ["https://a.test"] });
    const out = await toolsWith({ search }).web_search.run({ query: "weather" });
    expect(search).toHaveBeenCalledWith("weather");
    expect(out).toContain("Sunny");
    expect(out).toContain("https://a.test");
  });

  it("throws a Tool error when Gemini is unavailable", async () => {
    const search = vi.fn().mockRejectedValue(new Error("no gemini"));
    await expect(toolsWith({ search }).web_search.run({ query: "x" })).rejects.toThrow();
  });
});

describe("get_current_time", () => {
  it("returns the time in Asia/Jakarta (UTC+7)", async () => {
    const out = await toolsWith().get_current_time.run({});
    expect(out).toContain("2026-01-01");
    expect(out).toContain("07:00");
    expect(out).toContain("Asia/Jakarta");
  });
});

describe("get_redeem_codes", () => {
  it("lists active codes for a game", async () => {
    const getCodes = vi.fn().mockResolvedValue(["AAA", "BBB"]);
    const out = await toolsWith({ getCodes }).get_redeem_codes.run({ game: "gi" });
    expect(getCodes).toHaveBeenCalledWith("gi");
    expect(out).toContain("AAA");
    expect(out).toContain("BBB");
  });

  it("says so when there are no codes", async () => {
    const out = await toolsWith({ getCodes: vi.fn().mockResolvedValue([]) }).get_redeem_codes.run({
      game: "hsr",
    });
    expect(out).toMatch(/no active codes/i);
  });

  it("rejects an unknown game", async () => {
    await expect(toolsWith().get_redeem_codes.run({ game: "chess" })).rejects.toThrow();
  });
});

describe("get_player_showcase", () => {
  it("shortens an Enka player to text", async () => {
    const getPlayer = vi.fn().mockResolvedValue({
      uid: "800000001",
      player: {
        username: "Traveler",
        levels: { world: 8, rank: 60 },
        achievements: 500,
        abyss: { floor: 12, chamber: 3, stars: 36 },
      },
    });
    const out = await toolsWith({ getPlayer }).get_player_showcase.run({
      game: "genshin",
      uid: "800000001",
    });
    expect(getPlayer).toHaveBeenCalledWith("genshin", "800000001");
    expect(out).toContain("Traveler");
    expect(out).toContain("Adventure Rank: 60");
    expect(out).toContain("Floor 12");
  });

  it("rejects an unknown game", async () => {
    await expect(toolsWith().get_player_showcase.run({ game: "zzz", uid: "1" })).rejects.toThrow();
  });

  it("propagates an Enka failure", async () => {
    const getPlayer = vi.fn().mockRejectedValue(new Error("404"));
    await expect(
      toolsWith({ getPlayer }).get_player_showcase.run({ game: "starrail", uid: "1" }),
    ).rejects.toThrow();
  });
});
