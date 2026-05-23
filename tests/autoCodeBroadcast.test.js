import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node-cron", () => ({
  default: {
    schedule: vi.fn(() => ({ stop: vi.fn() })),
  },
}));

vi.mock("../utils/codeScraper.js", () => ({
  getAllNewCodes: vi.fn(),
  saveCodes: vi.fn(),
}));

vi.mock("../utils/redeemCodeChannels.js", () => ({
  getCodeChannels: vi.fn(() => []),
}));

vi.mock("../helper/redeemEmbed.js", () => ({
  createRedeemEmbed: vi.fn(() => ({})),
}));

import { setupCodeScraperCron, checkAndBroadcast } from "../utils/autoCodeBroadcast.js";
import { getAllNewCodes } from "../utils/codeScraper.js";
import cron from "node-cron";

describe("autoCodeBroadcast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops previous scraper job before scheduling a new one", () => {
    const client = {};

    setupCodeScraperCron(client);
    setupCodeScraperCron(client);

    expect(cron.schedule).toHaveBeenCalledTimes(2);
    expect(cron.schedule.mock.results[0].value.stop).toHaveBeenCalledTimes(1);
  });

  it("skips overlapping code checks", async () => {
    getAllNewCodes.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ gi: [], hsr: [], zzz: [], wuwa: [], endfield: [] }), 20)));

    const client = { channels: { fetch: vi.fn() } };

    const first = checkAndBroadcast(client);
    const second = await checkAndBroadcast(client);

    await first;

    expect(second).toBeUndefined();
    expect(getAllNewCodes).toHaveBeenCalledTimes(1);
  });
});
