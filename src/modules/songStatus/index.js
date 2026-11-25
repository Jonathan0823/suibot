import { ActivityType } from "discord.js";
import defaultPrisma from "../../lib/prisma.js";

const ROTATE_MS = 1000 * 60;

/**
 * Song list module: owns the table, its cache and the "Listening to" status rotation.
 * @param {{ prisma: any, setInterval?: typeof setInterval }} deps
 */
export function createSongStatus({ prisma, setInterval = globalThis.setInterval } = {}) {
  let songs = [];

  const load = async () => {
    const data = await prisma.songList.findMany();
    songs = data.map((entry) => entry.songName);

    console.log("Loaded songs:", songs);
    return songs;
  };

  /** Load songs and rotate the client's activity every minute. */
  const start = async (client) => {
    await load();

    setInterval(() => {
      const randomSong = songs[Math.floor(Math.random() * songs.length)];
      client.user.setActivity(randomSong, {
        type: ActivityType.Listening,
      });
    }, ROTATE_MS);
  };

  const add = async (songName) => {
    await prisma.songList.create({
      data: {
        songName,
      },
    });

    await load();
  };

  /** Throws if the delete fails; the cache is not refreshed in that case. */
  const remove = async (songName) => {
    await prisma.songList.delete({
      where: {
        songName,
      },
    });

    await load();
  };

  return { start, add, remove };
}

export default createSongStatus({ prisma: defaultPrisma });
