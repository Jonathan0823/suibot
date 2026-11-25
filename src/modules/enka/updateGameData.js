// Child process for startCacheUpdater: updates one game's Enka game data on disk and exits.
// It runs apart from the bot because the libraries' unzip code can throw from callbacks and
// leaves write-stream errors unhandled; a crash here must not take the bot down.
// Usage: node src/modules/enka/updateGameData.js <genshin|starrail>
import { EnkaClient } from "enka-network-api";
import { StarRail } from "starrail.js";

const CLIENTS = {
  genshin: () => new EnkaClient({ showFetchCacheLog: false }),
  starrail: () => new StarRail({ showFetchCacheLog: false }),
};

const game = process.argv[2];
const createClient = CLIENTS[game];
if (!createClient) {
  console.error(`Unknown game: ${game}`);
  process.exit(2);
}

let updated = false;
await createClient().cachedAssetsManager.updateContents({
  onUpdateEnd: async () => {
    updated = true;
  },
});
process.send?.({ updated });
process.exit(0);
