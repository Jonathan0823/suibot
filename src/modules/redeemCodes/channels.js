/**
 * Registered output channels (CodeChannel table), cached in memory.
 * @param {{ prisma: any, games: string[] }} deps
 */
export function createChannelRegistry({ prisma, games }) {
  let channels = [];
  const allowed = new Set(games);

  async function load() {
    channels = await prisma.codeChannel.findMany();
    console.log("Loaded code channels:");
    console.table(channels);
  }

  const forGame = (game) =>
    channels.filter((entry) => entry.gameType === game).map((e) => e.channelId);

  async function add(game, channelId) {
    if (!allowed.has(game)) throw new Error("Invalid game type.");

    await prisma.codeChannel.create({ data: { gameType: game, channelId } });
    await load();
  }

  return { load, forGame, add };
}
