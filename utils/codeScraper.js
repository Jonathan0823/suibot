import prisma from "../lib/prisma.js";
import * as cheerio from "cheerio";

// API endpoints for HoYoverse games
const HOYO_API_BASE = "https://hoyo-codes.seria.moe/codes";
const GAME_ENDPOINTS = {
  gi: `${HOYO_API_BASE}?game=genshin`,
  hsr: `${HOYO_API_BASE}?game=hkrpg`,
  zzz: `${HOYO_API_BASE}?game=nap`,
};

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

// Wuthering Waves scraping source
const WUWA_SOURCE = "https://game8.co/games/Wuthering-Waves/archives/453149";
// Arknights: Endfield scraping source
const ENDFIELD_SOURCE =
  "https://game8.co/games/Arknights-Endfield/archives/571509";

const SCRAPED_CODE_GAMES = ["gi", "hsr", "zzz", "wuwa", "endfield"];
const MAX_CODES_PER_GAME = 200;

const scrapedCodeCache = new Map();
let scrapedCodeCacheLoaded = false;

function createGameCache() {
  return { set: new Set(), order: [] };
}

function getGameCache(game) {
  if (!scrapedCodeCache.has(game)) {
    scrapedCodeCache.set(game, createGameCache());
  }

  return scrapedCodeCache.get(game);
}

function addCodeToCache(game, code) {
  const gameCache = getGameCache(game);
  if (gameCache.set.has(code)) return;

  gameCache.set.add(code);
  gameCache.order.push(code);

  while (gameCache.order.length > MAX_CODES_PER_GAME) {
    const oldest = gameCache.order.shift();
    if (oldest) gameCache.set.delete(oldest);
  }
}

function removeCodeFromCache(game, code) {
  const gameCache = scrapedCodeCache.get(game);
  if (!gameCache?.set.has(code)) return;

  gameCache.set.delete(code);
  gameCache.order = gameCache.order.filter((entry) => entry !== code);
}

function getCachedCodesForGame(game) {
  const gameCache = scrapedCodeCache.get(game);
  return gameCache ? [...gameCache.order] : [];
}

async function ensureScrapedCodeCache() {
  if (scrapedCodeCacheLoaded) return scrapedCodeCache;

  for (const game of SCRAPED_CODE_GAMES) {
    scrapedCodeCache.set(game, createGameCache());
  }

  const activeCodes = await prisma.scrapedCode.findMany({
    where: { status: "active" },
    select: { code: true, game: true },
    orderBy: { createdAt: "asc" },
  });

  for (const { game, code } of activeCodes) {
    addCodeToCache(game, code);
  }

  scrapedCodeCacheLoaded = true;
  return scrapedCodeCache;
}

async function revalidateCacheMisses(game, codes) {
  if (codes.length === 0) {
    return [];
  }

  const cachedSet = getGameCache(game).set;
  const cacheMisses = codes.filter((code) => !cachedSet.has(code.code));

  if (cacheMisses.length === 0) {
    return codes;
  }

  const existingCodes = await prisma.scrapedCode.findMany({
    where: {
      game,
      status: "active",
      code: { in: cacheMisses.map((code) => code.code) },
    },
    select: { code: true },
  });

  const existingSet = new Set(existingCodes.map((entry) => entry.code));

  for (const { code } of existingCodes) {
    addCodeToCache(game, code);
  }

  return codes.filter(
    (code) => !cachedSet.has(code.code) && !existingSet.has(code.code),
  );
}

/**
 * Scrape Wuthering Waves codes from game8.co
 * Format: "- CODE - rewards, rewards, rewards"
 * Example: "- BACKTOSCHOOL - 100 Astrite, 4 Premium Resonance Potions"
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

    // Game8 uses list items with format: "- CODE - rewards"
    // Look for list items containing codes
    $("ul li, ol li").each((_, li) => {
      const text = $(li).text().trim();

      // Match pattern: CODE - rewards (where CODE is uppercase letters/numbers)
      const re = /^([A-Z0-9]{6,20})\s*[-–]\s*(.+)$/i;
      const match = re.exec(text);
      if (match) {
        const code = match[1].toUpperCase();
        const rewards = match[2].trim();

        // Only accept if rewards contain "Astrite" (Wuwa premium currency)
        // This filters out false positives
        if (
          code &&
          rewards &&
          !code.includes(" ") &&
          /astrite/i.test(rewards)
        ) {
          codes.push({ code, rewards });
        }
      }
    });

    // Fallback: also check for codes in paragraph text
    if (codes.length === 0) {
      const bodyText = $("body").text();
      // Match: WORD - description pattern for codes
      const codePattern = /\b([A-Z]{6,20})\b\s*[-–]\s*(\d+\s*Astrite[^.]*)/gi;
      let match;
      while ((match = codePattern.exec(bodyText)) !== null) {
        codes.push({
          code: match[1].toUpperCase(),
          rewards: match[2].trim(),
        });
      }
    }

    // Remove duplicates
    const uniqueCodes = codes.filter(
      (code, index, self) =>
        index === self.findIndex((c) => c.code === code.code),
    );

    return uniqueCodes;
  } catch (error) {
    console.error("Error fetching Wuwa codes:", error);
    return [];
  }
}

/**
 * Scrape Arknights: Endfield codes from game8.co
 * @returns {Promise<Array<{code: string, rewards: string}>>}
 */
async function fetchEndfieldCodes() {
  try {
    const response = await fetch(ENDFIELD_SOURCE, {
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

    // Find the 'Active Codes' header
    // User specified: <h3 class="a-header--3" id="hm_1">Active Codes in January 2026</h3>
    // We look for any h3 containing "Active Code"
    const header = $("h3")
      .filter((_, el) => {
        return /Active Code/i.exec($(el)
          .text());
      })
      .first();

    if (header.length > 0) {
      // Find the table immediately following this header
      const table = header
        .nextAll("div.a-table, table")
        .first()
        .find("table")
        .addBack("table")
        .first();

      if (table.length > 0) {
        const rows = table.find("tbody tr");

        rows.each((_, row) => {
          // Skip header row
          if ($(row).find("th").length > 0) return;

          const cells = $(row).find("td");
          if (cells.length >= 2) {
            const codeCell = $(cells[0]);
            const rewardCell = $(cells[1]);

            // Code is bold text in first cell
            // Code is bold text in first cell, or in an input value
            let code = "";
            const inputVal = codeCell
              .find("input.a-clipboard__textInput")
              .val();
            if (inputVal) {
              code = inputVal.trim();
            } else {
              code = codeCell.find("b").text().trim();
              if (!code) code = codeCell.find("strong").text().trim(); // Try strong
              if (!code) {
                // Fallback: Get first non-empty text line
                const text = codeCell.text().trim();
                code = text.split(/\s/)[0];
              }
            }

            // Rewards are in divs
            const rewardsList = [];
            rewardCell.find("div.align").each((_, div) => {
              let text = $(div).text().trim().replace(/\s+/g, " ");

              if (text) rewardsList.push(text);
            });

            const rewards = rewardsList.join(", ");

            if (code && rewards) {
              codes.push({ code, rewards });
            }
          }
        });
      }
    }

    // Remove duplicates
    const uniqueCodes = codes.filter(
      (code, index, self) =>
        index === self.findIndex((c) => c.code === code.code),
    );

    return uniqueCodes;
  } catch (error) {
    console.error("Error fetching Endfield codes:", error);
    return [];
  }
}
/**
 * Get new codes that are not yet in the database
 * @param {string} game - Game type: gi, hsr, zzz, wuwa
 * @param {Array<{code: string, rewards: string}>} codes - Fetched codes
 * @returns {Promise<Array<{code: string, rewards: string}>>}
 */
async function filterNewCodes(game, codes, existingCodesByGame = new Map()) {
  if (codes.length === 0) return [];

  const existingSet = existingCodesByGame.get(game) || new Set();
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

  for (const { code } of codes) {
    addCodeToCache(game, code);
  }
}

/**
 * Fetch all new codes for all games
 * @returns {Promise<{gi: Array, hsr: Array, zzz: Array, wuwa: Array}>}
 */
async function getAllNewCodes() {
  await ensureScrapedCodeCache();

  const results = {
    gi: [],
    hsr: [],
    zzz: [],
    wuwa: [],
    endfield: [],
  };

  const fetchedCodes = {
    gi: await fetchHoyoCodes("gi"),
    hsr: await fetchHoyoCodes("hsr"),
    zzz: await fetchHoyoCodes("zzz"),
    wuwa: await fetchWuwaCodes(),
    endfield: await fetchEndfieldCodes(),
  };

  const existingCodesByGame = new Map(
    SCRAPED_CODE_GAMES.map((game) => [game, getGameCache(game).set]),
  );

  for (const game of Object.keys(fetchedCodes)) {
    const cachedFiltered = await filterNewCodes(
      game,
      fetchedCodes[game],
      existingCodesByGame,
    );

    results[game] = await revalidateCacheMisses(game, cachedFiltered);
  }

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

  for (const code of codes) {
    removeCodeFromCache(game, code);
  }
}

export {
  fetchHoyoCodes,
  fetchWuwaCodes,
  fetchEndfieldCodes,
  filterNewCodes,
  ensureScrapedCodeCache,
  revalidateCacheMisses,
  addCodeToCache,
  removeCodeFromCache,
  getCachedCodesForGame,
  saveCodes,
  getAllNewCodes,
  markCodesExpired,
};
