import nodeCron from "node-cron";
import defaultPrisma from "../../lib/prisma.js";
import { createCodeStore } from "./cache.js";
import { createChannelRegistry } from "./channels.js";
import { createRedeemEmbed } from "./embed.js";
import { GAME_IDS, INPUT_CHANNELS } from "./gameConfig.js";
import { createScraper } from "./scraper.js";

const CRON_SCHEDULE = "*/10 * * * *";
const STARTUP_CHECK_DELAY_MS = 10000;

/**
 * Redeem code module: scraping, persistence, caching and broadcasting.
 * @param {{ prisma: any, fetch?: typeof fetch, cron?: { schedule: Function } }} deps
 */
export function createRedeemCodes({
  prisma,
  fetch = (...args) => globalThis.fetch(...args),
  cron = nodeCron,
} = {}) {
  const scraper = createScraper({ fetch });
  const store = createCodeStore({ prisma, games: GAME_IDS });
  const channels = createChannelRegistry({ prisma, games: GAME_IDS });

  let defaultClient = null;
  let isChecking = false;
  let job = null;

  /**
   * Send codes to every registered channel for the game.
   * @param {string} game
   * @param {Array<{code: string, rewards?: string, value?: string}>} codes
   * @param {{ client?: import('discord.js').Client, autoScraped?: boolean }} [options]
   */
  async function broadcast(game, codes, options = {}) {
    const client = options.client ?? defaultClient;
    const targets = channels.forGame(game);
    const embed = createRedeemEmbed(game, codes, {
      showAutoScraped: options.autoScraped,
    });

    if (targets.length === 0) {
      console.log(`No channels registered for ${game}`);
    } else if (embed && client) {
      for (const channelId of targets) {
        try {
          const channel = await client.channels.fetch(channelId);
          if (channel?.isTextBased()) {
            await channel.send({ embeds: [embed] });

            // Send individual codes for easy copy-paste
            for (const { code } of codes) {
              await channel.send(code);
            }

            console.log(`Sent ${game} codes to channel ${channelId}`);
          }
        } catch (error) {
          console.error(`Failed to send ${game} codes to ${channelId}:`, error);
        }
      }
    }

  }

  async function fetchAllNew() {
    await store.ensureLoaded();

    const fetched = {
      gi: await scraper.fetchHoyoCodes("gi"),
      hsr: await scraper.fetchHoyoCodes("hsr"),
      zzz: await scraper.fetchHoyoCodes("zzz"),
      wuwa: await scraper.fetchWuwaCodes(),
      endfield: await scraper.fetchEndfieldCodes(),
    };

    const results = {};
    for (const game of Object.keys(fetched)) {
      results[game] = await store.revalidateCacheMisses(game, store.filterNew(game, fetched[game]));
    }
    return results;
  }

  /** Scrape all sources and broadcast anything new. Skips if already running. */
  async function checkForNew() {
    if (isChecking) {
      console.log("[CodeScraper] Skipping overlapping check");
      return;
    }

    isChecking = true;
    console.log("[CodeScraper] Checking for new codes...");

    try {
      const newCodes = await fetchAllNew();

      for (const [game, codes] of Object.entries(newCodes)) {
        if (codes.length > 0) {
          console.log(`[CodeScraper] Found ${codes.length} new ${game} codes`);
          await broadcast(game, codes, { autoScraped: true });
          await store.save(game, codes);
        }
      }

      console.log("[CodeScraper] Check complete");
    } catch (error) {
      console.error("[CodeScraper] Error during check:", error);
    } finally {
      isChecking = false;
    }
  }

  /** Load channels, schedule the periodic check and run one shortly after startup. */
  async function start(client) {
    defaultClient = client;
    await channels.load();

    if (job) job.stop();
    job = cron.schedule(CRON_SCHEDULE, () => checkForNew(), {
      timezone: "Asia/Jakarta",
    });
    console.log("[CodeScraper] Cron job scheduled (every 10 minutes)");

    setTimeout(async () => {
      console.log("[CodeScraper] Running initial check...");
      await checkForNew();
    }, STARTUP_CHECK_DELAY_MS);
  }

  async function getActiveCodes(game) {
    await store.ensureLoaded();
    return store.getCached(game);
  }

  const addChannel = (game, channelId) => channels.add(game, channelId);
  const gameForInputChannel = (channelId) => INPUT_CHANNELS[channelId] ?? null;

  return {
    start,
    checkForNew,
    broadcast,
    getActiveCodes,
    addChannel,
    gameForInputChannel,
    markExpired: (game, codes) => store.markExpired(game, codes),
  };
}

export default createRedeemCodes({ prisma: defaultPrisma });