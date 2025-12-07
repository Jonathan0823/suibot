import cron from "node-cron";
import { getCodeChannels } from "../utils/redeemCodeChannels.js";
import { getAllNewCodes, saveCodes } from "../utils/codeScraper.js";
import { createRedeemEmbed } from "../helper/redeemEmbed.js";

/**
 * Broadcast new codes to all registered channels
 * @param {import('discord.js').Client} client - Discord client
 * @param {string} game - Game type
 * @param {Array<{code: string, rewards: string}>} codes - New codes
 */
async function broadcastCodes(client, game, codes) {
    const channels = getCodeChannels(game);
    if (channels.length === 0) {
        console.log(`No channels registered for ${game}`);
        return;
    }

    const embed = createRedeemEmbed(game, codes, { showAutoScraped: true });

    for (const channelId of channels) {
        try {
            const channel = await client.channels.fetch(channelId);
            if (channel && channel.isTextBased()) {
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

/**
 * Check for new codes and broadcast them
 * @param {import('discord.js').Client} client - Discord client
 */
async function checkAndBroadcast(client) {
    console.log("[CodeScraper] Checking for new codes...");

    try {
        const newCodes = await getAllNewCodes();

        for (const [game, codes] of Object.entries(newCodes)) {
            if (codes.length > 0) {
                console.log(`[CodeScraper] Found ${codes.length} new ${game} codes`);

                // Broadcast to channels
                await broadcastCodes(client, game, codes);

                // Save to database
                await saveCodes(game, codes);
            }
        }

        console.log("[CodeScraper] Check complete");
    } catch (error) {
        console.error("[CodeScraper] Error during check:", error);
    }
}

/**
 * Setup cron job for periodic code checking
 * @param {import('discord.js').Client} client - Discord client
 */
function setupCodeScraperCron(client) {
    // Run every 30 minutes
    cron.schedule(
        "*/30 * * * *",
        async () => {
            await checkAndBroadcast(client);
        },
        {
            timezone: "Asia/Jakarta",
        },
    );

    console.log("[CodeScraper] Cron job scheduled (every 30 minutes)");

    // Also run once on startup after a short delay
    setTimeout(async () => {
        console.log("[CodeScraper] Running initial check...");
        await checkAndBroadcast(client);
    }, 10000);
}

export { setupCodeScraperCron, checkAndBroadcast };
