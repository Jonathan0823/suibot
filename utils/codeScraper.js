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

        // Look for code elements - adjust selectors based on actual site structure
        $("table tr").each((_, row) => {
            const cells = $(row).find("td");
            if (cells.length >= 2) {
                const code = $(cells[0]).text().trim();
                const rewards = $(cells[1]).text().trim();
                if (code && code.length > 3 && !code.toLowerCase().includes("code")) {
                    codes.push({ code, rewards });
                }
            }
        });

        // Fallback: look for code patterns in the page
        if (codes.length === 0) {
            const codePattern = /[A-Z0-9]{8,20}/g;
            const text = $("body").text();
            const matches = text.match(codePattern);
            if (matches) {
                const uniqueCodes = [...new Set(matches)];
                uniqueCodes.forEach((code) => {
                    codes.push({ code, rewards: "" });
                });
            }
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
