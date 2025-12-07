/**
 * Integration Test Script for Code Scraper
 * 
 * Usage: node scripts/testCodeScraper.js
 * 
 * This script will:
 * 1. Fetch all codes from all games (GI, HSR, ZZZ, Wuwa)
 * 2. Connect to Discord
 * 3. Send embeds to test channel
 */

import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { fetchHoyoCodes, fetchWuwaCodes } from "../utils/codeScraper.js";
import { createRedeemEmbed } from "../helper/redeemEmbed.js";

const TEST_CHANNEL_ID = "1447126677179338864";

async function runTest() {
    console.log("🧪 Starting Integration Test...\n");

    // Step 1: Fetch all codes
    console.log("📥 Fetching codes from all sources...\n");

    const giCodes = await fetchHoyoCodes("gi");
    console.log(`   GI: ${giCodes.length} codes`);
    giCodes.forEach((c) => console.log(`      - ${c.code}: ${c.rewards.substring(0, 50)}...`));

    const hsrCodes = await fetchHoyoCodes("hsr");
    console.log(`   HSR: ${hsrCodes.length} codes`);
    hsrCodes.forEach((c) => console.log(`      - ${c.code}: ${c.rewards.substring(0, 50)}...`));

    const zzzCodes = await fetchHoyoCodes("zzz");
    console.log(`   ZZZ: ${zzzCodes.length} codes`);
    zzzCodes.forEach((c) => console.log(`      - ${c.code}: ${c.rewards.substring(0, 50)}...`));

    const wuwaCodes = await fetchWuwaCodes();
    console.log(`   Wuwa: ${wuwaCodes.length} codes`);
    wuwaCodes.forEach((c) => console.log(`      - ${c.code}: ${c.rewards.substring(0, 50)}...`));

    console.log("\n✅ Fetch complete!\n");

    // Step 2: Connect to Discord
    console.log("🤖 Connecting to Discord...");

    const client = new Client({
        intents: [GatewayIntentBits.Guilds],
    });

    await client.login(process.env.DISCORD_BOT_TOKEN);
    console.log(`   Logged in as ${client.user.tag}\n`);

    // Step 3: Send to test channel
    console.log(`📤 Sending to test channel (${TEST_CHANNEL_ID})...\n`);

    const testChannel = await client.channels.fetch(TEST_CHANNEL_ID);
    if (!testChannel || !testChannel.isTextBased()) {
        console.error("❌ Test channel not found!");
        client.destroy();
        process.exit(1);
    }

    // Send GI
    if (giCodes.length > 0) {
        const embed = createRedeemEmbed("gi", giCodes, { showAutoScraped: true });
        await testChannel.send({ embeds: [embed] });
        for (const { code } of giCodes) {
            await testChannel.send(code);
        }
        console.log("   ✅ GI codes sent");
    }

    // Send HSR
    if (hsrCodes.length > 0) {
        const embed = createRedeemEmbed("hsr", hsrCodes, { showAutoScraped: true });
        await testChannel.send({ embeds: [embed] });
        for (const { code } of hsrCodes) {
            await testChannel.send(code);
        }
        console.log("   ✅ HSR codes sent");
    }

    // Send ZZZ
    if (zzzCodes.length > 0) {
        const embed = createRedeemEmbed("zzz", zzzCodes, { showAutoScraped: true });
        await testChannel.send({ embeds: [embed] });
        for (const { code } of zzzCodes) {
            await testChannel.send(code);
        }
        console.log("   ✅ ZZZ codes sent");
    }

    // Send Wuwa
    if (wuwaCodes.length > 0) {
        const embed = createRedeemEmbed("wuwa", wuwaCodes, { showAutoScraped: true });
        await testChannel.send({ embeds: [embed] });
        for (const { code } of wuwaCodes) {
            await testChannel.send(code);
        }
        console.log("   ✅ Wuwa codes sent");
    }

    console.log("\n🎉 Integration test complete!");

    client.destroy();
    process.exit(0);
}

runTest().catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
});
