import prisma from "../lib/prisma.js";
import * as cheerio from "cheerio";

// API endpoints for HoYoverse games
const HOYO_API_BASE = "https://hoyo-codes.seria.moe/codes";
const GAME_ENDPOINTS = {
    gi: `${HOYO_API_BASE}?game=genshin`,
    hsr: `${HOYO_API_BASE}?game=hkrpg`,
    zzz: `${HOYO_API_BASE}?game=nap`,
};

// Wuthering Waves scraping source
const WUWA_SOURCE = "https://wuthering.gg/codes";

/**
 * Fetch codes from hoyo-codes.seria.moe API
 * @param {string} game - Game type: gi, hsr, zzz
 * @returns {Promise<Array<{code: string, rewards: string}>>}
 */
async function fetchHoyoCodes(game) {
    const endpoint = GAME_ENDPOINTS[game];
    if (!endpoint) {
        console.error(`Unknown game type: ${game}`);
        return [];
    }

    try {
        const response = await fetch(endpoint);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        // Filter only OK status codes
        return data.codes
            .filter((c) => c.status === "OK")
            .map((c) => ({
                code: c.code,
                rewards: c.rewards || "",
            }));
    } catch (error) {
        console.error(`Error fetching ${game} codes:`, error);
        return [];
    }
}

/**
 * Scrape Wuthering Waves codes from wuthering.gg
 * HTML structure:
 * <tr class="active">
 *   <td class="code">WUTHERINGGIFT</td>           <!-- Column 0: Code -->
 *   <td class="copy"><button>COPY</button></td>    <!-- Column 1: Copy button (skip) -->
 *   <td><ul><li>50 Astrite</li>...</ul></td>       <!-- Column 2: Rewards -->
 *   <td>12/20/2024</td>                            <!-- Column 3: Date -->
 * </tr>
 * @returns {Promise<Array<{code: string, rewards: string}>>}
 */
async function fetchWuwaCodes() {
    try {
        const response = await fetch(WUWA_SOURCE, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        const codes = [];

        // Find rows with class "active" (active codes)
        $("tr.active").each((_, row) => {
            // Get code from td.code
            const code = $(row).find("td.code").text().trim();

            // Get rewards from the 3rd td (index 2), which contains ul > li
            const rewardsList = [];
            $(row)
                .find("td:nth-child(3) ul li")
                .each((_, li) => {
                    rewardsList.push($(li).text().trim());
                });
            const rewards = rewardsList.join(", ");

            if (code && code.length > 3) {
                codes.push({ code, rewards });
            }
        });

        // Fallback: try old method if no active rows found
        if (codes.length === 0) {
            $("table tr").each((_, row) => {
                const codeCell = $(row).find("td.code");
                if (codeCell.length > 0) {
                    const code = codeCell.text().trim();
                    const rewardsList = [];
                    $(row)
                        .find("td:nth-child(3) ul li")
                        .each((_, li) => {
                            rewardsList.push($(li).text().trim());
                        });
                    const rewards = rewardsList.join(", ");

                    if (code && code.length > 3) {
                        codes.push({ code, rewards });
                    }
                }
            });
        }

        return codes;
    } catch (error) {
        console.error("Error fetching Wuwa codes:", error);
        return [];
    }
}

/**
 * Get new codes that are not yet in the database
 * @param {string} game - Game type: gi, hsr, zzz, wuwa
 * @param {Array<{code: string, rewards: string}>} codes - Fetched codes
 * @returns {Promise<Array<{code: string, rewards: string}>>}
 */
async function filterNewCodes(game, codes) {
    if (codes.length === 0) return [];

    const existingCodes = await prisma.scrapedCode.findMany({
        where: {
            game,
            code: { in: codes.map((c) => c.code) },
        },
        select: { code: true },
    });

    const existingSet = new Set(existingCodes.map((c) => c.code));
    return codes.filter((c) => !existingSet.has(c.code));
}

/**
 * Save codes to database
 * @param {string} game - Game type
 * @param {Array<{code: string, rewards: string}>} codes - Codes to save
 */
async function saveCodes(game, codes) {
    if (codes.length === 0) return;

    await prisma.scrapedCode.createMany({
        data: codes.map((c) => ({
            code: c.code,
            game,
            rewards: c.rewards,
            status: "active",
        })),
        skipDuplicates: true,
    });
}

/**
 * Fetch all new codes for all games
 * @returns {Promise<{gi: Array, hsr: Array, zzz: Array, wuwa: Array}>}
 */
async function getAllNewCodes() {
    const results = {
        gi: [],
        hsr: [],
        zzz: [],
        wuwa: [],
    };

    // Fetch from HoYo API
    for (const game of ["gi", "hsr", "zzz"]) {
        const codes = await fetchHoyoCodes(game);
        results[game] = await filterNewCodes(game, codes);
    }

    // Fetch Wuwa codes
    const wuwaCodes = await fetchWuwaCodes();
    results.wuwa = await filterNewCodes("wuwa", wuwaCodes);

    return results;
}

/**
 * Mark codes as expired in database
 * @param {string} game - Game type
 * @param {string[]} codes - Code strings to mark as expired
 */
async function markCodesExpired(game, codes) {
    if (codes.length === 0) return;

    await prisma.scrapedCode.updateMany({
        where: {
            game,
            code: { in: codes },
        },
        data: { status: "expired" },
    });
}

export {
    fetchHoyoCodes,
    fetchWuwaCodes,
    filterNewCodes,
    saveCodes,
    getAllNewCodes,
    markCodesExpired,
};
