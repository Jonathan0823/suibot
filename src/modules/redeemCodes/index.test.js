import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRedeemCodes } from "./index.js";

function makePrisma() {
  return {
    codeChannel: {
      findMany: vi.fn().mockResolvedValue([{ channelId: "c1", gameType: "gi" }]),
      create: vi.fn().mockResolvedValue({}),
    },
    scrapedCode: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
    },
  };
}

const emptyFetch = () =>
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ codes: [] }),
    text: async () => "<html><body></body></html>",
  });

describe("redeemCodes", () => {
  let prisma;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "table").mockImplementation(() => {});
    prisma = makePrisma();
  });

  it("stops the previous cron job before scheduling a new one", async () => {
    vi.useFakeTimers();
    const cron = { schedule: vi.fn(() => ({ stop: vi.fn() })) };
    const redeem = createRedeemCodes({ prisma, fetch: emptyFetch(), cron });

    await redeem.start({});
    await redeem.start({});

    expect(cron.schedule).toHaveBeenCalledTimes(2);
    expect(cron.schedule.mock.results[0].value.stop).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("skips overlapping checks", async () => {
    const fetch = vi.fn(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: async () => ({ codes: [] }),
                text: async () => "",
              }),
            10,
          ),
        ),
    );
    const redeem = createRedeemCodes({ prisma, fetch });

    const first = redeem.checkForNew();
    const second = await redeem.checkForNew();
    await first;

    expect(second).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("broadcasts to registered channels and persists the codes", async () => {
    const cron = { schedule: vi.fn(() => ({ stop: vi.fn() })) };
    const channel = { isTextBased: () => true, send: vi.fn() };
    const client = { channels: { fetch: vi.fn().mockResolvedValue(channel) } };
    vi.useFakeTimers();
    const redeem = createRedeemCodes({ prisma, fetch: emptyFetch(), cron });
    await redeem.start(client);
    vi.useRealTimers();

    await redeem.broadcast("gi", [{ code: "ABC", value: "100 Primogems" }]);

    expect(client.channels.fetch).toHaveBeenCalledWith("c1");
    expect(channel.send).toHaveBeenCalledTimes(2);
    expect(channel.send).toHaveBeenLastCalledWith("ABC");
    expect(prisma.scrapedCode.createMany).toHaveBeenCalledWith({
      data: [{ code: "ABC", game: "gi", rewards: "100 Primogems", status: "active" }],
      skipDuplicates: true,
    });
    expect(await redeem.getActiveCodes("gi")).toEqual(["ABC"]);
  });

  it("does not report failure when persisting fails after a successful send", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    prisma.scrapedCode.createMany.mockRejectedValue(new Error("db down"));
    const cron = { schedule: vi.fn(() => ({ stop: vi.fn() })) };
    const channel = { isTextBased: () => true, send: vi.fn() };
    const client = { channels: { fetch: vi.fn().mockResolvedValue(channel) } };
    vi.useFakeTimers();
    const redeem = createRedeemCodes({ prisma, fetch: emptyFetch(), cron });
    await redeem.start(client);
    vi.useRealTimers();

    await expect(
      redeem.broadcast("gi", [{ code: "ABC", value: "100 Primogems" }]),
    ).resolves.toBeUndefined();

    expect(channel.send).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("broadcasts only codes the scraper finds new", async () => {
    prisma.scrapedCode.findMany.mockResolvedValue([{ game: "gi", code: "OLD" }]);
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        codes: [
          { code: "OLD", status: "OK", rewards: "a" },
          { code: "NEW", status: "OK", rewards: "b" },
        ],
      }),
      text: async () => "",
    });
    const redeem = createRedeemCodes({ prisma, fetch });
    vi.useFakeTimers();
    await redeem.start({ channels: { fetch: vi.fn() } });
    vi.useRealTimers();

    await redeem.checkForNew();

    const saved = prisma.scrapedCode.createMany.mock.calls.flatMap((c) =>
      c[0].data.map((d) => d.code),
    );
    expect(saved).toContain("NEW");
    expect(saved).not.toContain("OLD");
  });

  it("rejects unknown games and maps input channels", async () => {
    const redeem = createRedeemCodes({ prisma, fetch: emptyFetch() });
    await expect(redeem.addChannel("nope", "x")).rejects.toThrow("Invalid game type.");
    expect(redeem.gameForInputChannel("1337568739415167057")).toBe("gi");
    expect(redeem.gameForInputChannel("unknown")).toBeNull();
  });
});
