import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAlarms } from "./index.js";

const createFakes = (channels = []) => {
  const stops = [];
  const prisma = {
    alarmChannel: {
      findMany: vi.fn(async () => channels.map((channelId) => ({ channelId }))),
      findUnique: vi.fn(async ({ where }) =>
        channels.includes(where.channelId) ? { channelId: where.channelId } : null,
      ),
      create: vi.fn(async ({ data }) => {
        channels.push(data.channelId);
        return data;
      }),
    },
  };
  const jobs = [];
  const cron = {
    schedule: vi.fn((expression, fn, options) => {
      const job = { expression, fn, options, stop: vi.fn() };
      jobs.push(job);
      return job;
    }),
  };
  const sent = [];
  const channel = {
    id: "c1",
    isTextBased: () => true,
    viewable: true,
    send: vi.fn(async (payload) => sent.push(payload)),
  };
  const client = { channels: { fetch: vi.fn(async () => channel) } };
  return { prisma, cron, jobs, client, channel, sent, stops };
};

describe("alarms", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("start loads channels and schedules only hoyo daily in Asia/Jakarta", async () => {
    const f = createFakes(["c1"]);
    const alarms = createAlarms({ prisma: f.prisma, cron: f.cron, getColor: () => 1 });

    await alarms.start(f.client);

    expect(f.cron.schedule.mock.calls.map((c) => c[0])).toEqual(["0 4 * * *"]);
    expect(f.cron.schedule.mock.calls[0][2]).toEqual({ timezone: "Asia/Jakarta" });
  });

  it("a scheduled job sends to the loaded channels", async () => {
    const f = createFakes(["c1"]);
    const alarms = createAlarms({ prisma: f.prisma, cron: f.cron, getColor: () => 1 });
    await alarms.start(f.client);

    await f.jobs[0].fn();

    expect(f.client.channels.fetch).toHaveBeenCalledWith("c1");
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].components).toHaveLength(1);
  });

  it("addChannel writes, reloads and re-arms scheduled types, stopping old jobs", async () => {
    const f = createFakes([]);
    const alarms = createAlarms({ prisma: f.prisma, cron: f.cron, getColor: () => 1 });
    await alarms.start(f.client);

    const result = await alarms.addChannel("new");

    expect(result).toEqual({ ok: true });
    expect(f.prisma.alarmChannel.create).toHaveBeenCalledWith({ data: { channelId: "new" } });
    expect(f.cron.schedule).toHaveBeenCalledTimes(2);
    expect(f.jobs[0].stop).toHaveBeenCalled();
    f.client.channels.fetch.mockClear();
    await f.jobs[1].fn();
    expect(f.client.channels.fetch).toHaveBeenCalledWith("new");
  });

  it("addChannel does not write an existing channel", async () => {
    const f = createFakes(["c1"]);
    const alarms = createAlarms({ prisma: f.prisma, cron: f.cron });
    await alarms.start(f.client);

    expect(await alarms.addChannel("c1")).toEqual({ ok: false, reason: "exists" });
    expect(f.prisma.alarmChannel.create).not.toHaveBeenCalled();
  });

  it("scheduledTypes option schedules wuwa too", async () => {
    const f = createFakes();
    const alarms = createAlarms({
      prisma: f.prisma,
      cron: f.cron,
      scheduledTypes: ["hoyo", "wuwa"],
    });
    await alarms.start(f.client);
    expect(f.cron.schedule.mock.calls.map((c) => c[0])).toEqual(["0 4 * * *", "0 3 * * *"]);
  });

  it("fire sends the wuwa embed without components", async () => {
    const f = createFakes();
    const alarms = createAlarms({ prisma: f.prisma, cron: f.cron, getColor: () => 1 });

    await alarms.fire("wuwa", ["c1"], f.client);

    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].components).toBeUndefined();
  });
});
