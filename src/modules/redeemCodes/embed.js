import { EmbedBuilder } from "discord.js";
import getRandomColor from "../../utils/randomColor.js";
import { GAME_CONFIG } from "./gameConfig.js";

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
    wuwa: [{ pattern: /astrites?/gi, emoji: config.currencyEmoji }],
    endfield: [{ pattern: /oroberyl/gi, emoji: config.currencyEmoji }],
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

  const embed = new EmbedBuilder()
    .setTitle(`${config.emoji}   Redeem Code ${config.name}!`)
    .setColor(color)
    .setImage(
      "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExamJxbmZlc296ZWN5cnFuaDdoY2Z5cXBpbm9hdnhieW00em01NHRqOSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/hQaCjkWd8y86EtipeI/giphy.gif",
    )
    .setDescription(
      `Halo ${config.playerName}, ada kode redeem baru nih! Yuk segera di redeem!

**Redeem Codes:**
${codes
  .map((c) => {
    const rawReward = c.value || c.rewards || "";
    const reward = replaceCurrencyWithEmoji(rawReward, game);
    const linkPart = config.redeemLink ? `→ [Link](${config.redeemLink}${c.code})` : "";
    return `\`${c.code}\` ${config.currencyEmoji} ${linkPart}\n  ↳ ${reward}`;
  })
  .join("\n\n")}`,
    );

  if (options.showAutoScraped) {
    embed.setFooter({ text: "🤖 Auto-scraped by Suibot" }).setTimestamp();
  }

  return embed;
}
