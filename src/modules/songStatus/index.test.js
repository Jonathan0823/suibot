import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSongStatus } from "./index.js";

const createFakePrisma = (names = []) => ({
  songList: {
    findMany: vi.fn(async () => names.map((songName) => ({ songName }))),
    create: vi.fn(async ({ data }) => names.push(data.songName)),
    delete: vi.fn(async ({ where }) => {
      names.splice(names.indexOf(where.songName), 1);
    }),
  },
});

describe("songStatus", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("start loads songs and rotates the activity every 60s", async () => {
    const prisma = createFakePrisma(["only"]);
    const setInterval = vi.fn();
    const client = { user: { setActivity: vi.fn() } };
    const songs = createSongStatus({ prisma, setInterval });

    await songs.start(client);

    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 60000);
    setInterval.mock.calls[0][0]();
    expect(client.user.setActivity).toHaveBeenCalledWith("only", { type: 2 });
  });

  it("add and remove write then refresh the cache", async () => {
    const names = [];
    const prisma = createFakePrisma(names);
    const setInterval = vi.fn();
    const client = { user: { setActivity: vi.fn() } };
    const songs = createSongStatus({ prisma, setInterval });
    await songs.start(client);

    await songs.add("a");
    expect(prisma.songList.create).toHaveBeenCalledWith({ data: { songName: "a" } });
    setInterval.mock.calls[0][0]();
    expect(client.user.setActivity).toHaveBeenLastCalledWith("a", { type: 2 });

    await songs.remove("a");
    expect(prisma.songList.delete).toHaveBeenCalledWith({ where: { songName: "a" } });
  });

  it("remove propagates delete errors without refreshing", async () => {
    const prisma = createFakePrisma();
    prisma.songList.delete.mockRejectedValue(new Error("nope"));
    const songs = createSongStatus({ prisma, setInterval: vi.fn() });

    await expect(songs.remove("x")).rejects.toThrow("nope");
    expect(prisma.songList.findMany).not.toHaveBeenCalled();
  });
});
