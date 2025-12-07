import { EmbedBuilder } from "discord.js";
import getRandomColor from "./randomColor.js";

// Game configuration
export const GAME_CONFIG = {
    gi: {
        name: "Genshin Impact",
        emoji: "<:genshinimpact:1324355501466849331>",
        currencyEmoji: "<:primo:1334721457883971614>",
        playerName: "Traveler",
        redeemLink: "https://genshin.hoyoverse.com/en/gift?code=",
    },
    hsr: {
        name: "Honkai Star Rail",
        emoji: "<:hsr:1324355673567395921>",
        currencyEmoji: "<:jade:1334721376635846686>",
        playerName: "Trailblazer",
        redeemLink: "https://hsr.hoyoverse.com/gift?code=",
    },
    zzz: {
        name: "Zenless Zone Zero",
        emoji: "<:zenless:1324356078825377932>",
        currencyEmoji: "<:poly:1334721545477820557>",
        playerName: "Proxy",
        redeemLink: "https://zenless.hoyoverse.com/redemption?code=",
    },
    wuwa: {
        name: "Wuthering Waves",
        emoji: "<:chixiayatta:1336876161803882586>",
        currencyEmoji: "<:astrite:1364023503195734036>",
        playerName: "Rover",
        redeemLink: null, // No web redemption for Wuwa
    },
};

// Channel configuration for manual code input
export const CHANNEL_CONFIG = {
    "1337568739415167057": { game: "gi" },
    "1337568755462701177": { game: "hsr" },
    "1337568767395364938": { game: "zzz" },
    "1364022887022985279": { game: "wuwa" },
};

/**
 * Get game emoji
 * @param {string} game - Game type: gi, hsr, zzz, wuwa
 */
export const getEmoji = (game) => GAME_CONFIG[game]?.emoji || "";

/**
 * Get currency emoji
 * @param {string} game - Game type
 */
export const getCurrencyEmoji = (game) => GAME_CONFIG[game]?.currencyEmoji || "";

/**
 * Get game name
 * @param {string} game - Game type
 */
export const getGameName = (game) => GAME_CONFIG[game]?.name || "";

/**
 * Get player name for game
 * @param {string} game - Game type
 */
export const getPlayerName = (game) => GAME_CONFIG[game]?.playerName || "";

/**
 * Get redeem link for game
 * @param {string} game - Game type
 */
export const getRedeemLink = (game) => GAME_CONFIG[game]?.redeemLink || null;

/**
 * Replace currency names with emojis in rewards text
 * @param {string} text - Rewards text
 * @param {string} game - Game type
 */
function replaceCurrencyWithEmoji(text, game) {
    const config = GAME_CONFIG[game];
    if (!config || !text) return text;

    // Currency patterns for each game (case-insensitive)
    const replacements = {
        gi: [
            { pattern: /primogems?/gi, emoji: config.currencyEmoji },
            { pattern: /primogem ×/gi, emoji: config.currencyEmoji + " ×" },
        ],
        hsr: [
            { pattern: /stellar jades?/gi, emoji: config.currencyEmoji },
            { pattern: /stellar jade/gi, emoji: config.currencyEmoji },
        ],
        zzz: [
            { pattern: /polychromes?/gi, emoji: config.currencyEmoji },
            { pattern: /polychrome ×/gi, emoji: config.currencyEmoji + " ×" },
        ],
        wuwa: [
            { pattern: /astrites?/gi, emoji: config.currencyEmoji },
        ],
    };

    let result = text;
    const gameReplacements = replacements[game] || [];

    for (const { pattern, emoji } of gameReplacements) {
        result = result.replace(pattern, emoji);
    }

    return result;
}

/**
 * Create redeem code embed
 * @param {string} game - Game type
 * @param {Array<{code: string, value?: string, rewards?: string}>} codes - Code entries
 * @param {Object} options - Optional settings
 * @param {boolean} options.showAutoScraped - Show auto-scraped footer
 */
export function createRedeemEmbed(game, codes, options = {}) {
    const config = GAME_CONFIG[game];
    if (!config) return null;

    const color = getRandomColor();
    const maxCodeLength = Math.max(...codes.map((c) => c.code.length));
    const maxValueLength = Math.max(
        ...codes.map((c) => (c.value || c.rewards || "").length),
        1
    );

    const linkText = (code) =>
        config.redeemLink ? `→ [Link](${config.redeemLink}${code})` : "";

    const embed = new EmbedBuilder()
        .setTitle(`${config.emoji}   Redeem Code ${config.name}!`)
        .setColor(color)
        .setImage(
            "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExamJxbmZlc296ZWN5cnFuaDdoY2Z5cXBpbm9hdnhieW00em01NHRqOSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/hQaCjkWd8y86EtipeI/giphy.gif"
        )
        .setDescription(
            `Halo ${config.playerName}, ada kode redeem baru nih! Yuk segera di redeem!

**Redeem Codes:**
${codes
                .map((c) => {
                    const rawReward = c.value || c.rewards || "";
                    const reward = replaceCurrencyWithEmoji(rawReward, game);
                    const linkPart = config.redeemLink
                        ? `→ [Link](${config.redeemLink}${c.code})`
                        : "";
                    return `\`${c.code}\` ${config.currencyEmoji} ${linkPart}\n  ↳ ${reward}`;
                })
                .join("\n\n")}`
        );

    if (options.showAutoScraped) {
        embed.setFooter({ text: "🤖 Auto-scraped by Suibot" }).setTimestamp();
    }

    return embed;
}
