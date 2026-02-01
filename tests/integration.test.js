import "dotenv/config";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { Client, GatewayIntentBits } from "discord.js";
import { fetchHoyoCodes, fetchWuwaCodes, fetchEndfieldCodes } from "../utils/codeScraper.js";
import { createRedeemEmbed } from "../helper/redeemEmbed.js";

const TEST_CHANNEL_ID = "1447126677179338864";

describe("Discord Integration", () => {
    let client;
    let testChannel;

    beforeAll(async () => {
        client = new Client({
            intents: [GatewayIntentBits.Guilds],
        });

        await client.login(process.env.DISCORD_BOT_TOKEN);
        testChannel = await client.channels.fetch(TEST_CHANNEL_ID);

        if (!testChannel || !testChannel.isTextBased()) {
            throw new Error("Test channel not found or not text-based");
        }
    });

    afterAll(async () => {
        if (client) {
            await client.destroy();
        }
    });

    it("should fetch and broadcast Genshin Impact codes", async () => {
        const codes = await fetchHoyoCodes("gi");
        console.log(`GI: ${codes.length} codes found`);

        if (codes.length > 0) {
            const embed = createRedeemEmbed("gi", codes, { showAutoScraped: true });
            await testChannel.send({ embeds: [embed] });
            for (const { code } of codes) {
                await testChannel.send(code);
            }
        }
        expect(true).toBe(true); // assert no errors thrown
    }, 30000); // increase timeout for network ops

    it("should fetch and broadcast HSR codes", async () => {
        const codes = await fetchHoyoCodes("hsr");
        console.log(`HSR: ${codes.length} codes found`);

        if (codes.length > 0) {
            const embed = createRedeemEmbed("hsr", codes, { showAutoScraped: true });
            await testChannel.send({ embeds: [embed] });
            for (const { code } of codes) {
                await testChannel.send(code);
            }
        }
        expect(true).toBe(true);
    }, 30000);

    it("should fetch and broadcast ZZZ codes", async () => {
        const codes = await fetchHoyoCodes("zzz");
        console.log(`ZZZ: ${codes.length} codes found`);

        if (codes.length > 0) {
            const embed = createRedeemEmbed("zzz", codes, { showAutoScraped: true });
            await testChannel.send({ embeds: [embed] });
            for (const { code } of codes) {
                await testChannel.send(code);
            }
        }
        expect(true).toBe(true);
    }, 30000);

    it("should fetch and broadcast WuWa codes", async () => {
        const codes = await fetchWuwaCodes();
        console.log(`WuWa: ${codes.length} codes found`);

        if (codes.length > 0) {
            const embed = createRedeemEmbed("wuwa", codes, { showAutoScraped: true });
            await testChannel.send({ embeds: [embed] });
            for (const { code } of codes) {
                await testChannel.send(code);
            }
        }
        expect(true).toBe(true);
    }, 30000);

    it("should fetch and broadcast Endfield codes", async () => {
        const codes = await fetchEndfieldCodes();
        console.log(`Endfield: ${codes.length} codes found`);

        if (codes.length > 0) {
            const embed = createRedeemEmbed("endfield", codes, { showAutoScraped: true });
            await testChannel.send({ embeds: [embed] });
            for (const { code } of codes) {
                await testChannel.send(code);
            }
        }
        expect(true).toBe(true);
    }, 30000);
});
