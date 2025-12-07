import "dotenv/config";
import { removeWhitespace } from "../helper/titleCase.js";
import { getCodeChannels } from "../utils/redeemCodeChannels.js";
import { createRedeemEmbed, CHANNEL_CONFIG } from "../helper/redeemEmbed.js";

const AUTHORIZED_USER = "lynz727wysi";

const parseMessage = (content) => {
  // Expected format: code1 item1,code2 item2
  const codes = content.split(",").map((entry) => {
    const [code, ...valueParts] = entry.trim().split(" ");
    const value = valueParts.join(" ") || "";
    return {
      code: removeWhitespace(code.toUpperCase()),
      value: removeWhitespace(value),
    };
  });

  return codes;
};

export default {
  name: "messageCreate",
  async execute(message) {
    // Check if message is in one of the monitored channels
    const channelConfig = CHANNEL_CONFIG[message.channelId];
    if (!channelConfig) return;

    // Check if sender is authorized
    if (message.author.username !== AUTHORIZED_USER) {
      await message.reply("You are not authorized to use this channel.");
      await message.delete();
      return;
    }

    try {
      const codes = parseMessage(message.content);
      const gameType = channelConfig.game;

      // Create embed using shared helper
      const embed = createRedeemEmbed(gameType, codes);

      // Send to all output channels
      await Promise.all(
        getCodeChannels(gameType).map(async (channelId) => {
          try {
            const targetChannel =
              await message.client.channels.fetch(channelId);
            if (targetChannel && targetChannel.isTextBased()) {
              await targetChannel.send({ embeds: [embed] });

              for (const { code } of codes) {
                await targetChannel.send(code);
              }
            }
          } catch (error) {
            console.error(`Failed to send to channel ${channelId}:`, error);
          }
        }),
      );
    } catch (error) {
      console.error("Error processing message:", error);
      await message.reply(
        "Error: Invalid format. Please use: code1 item1,code2 item2",
      );
      setTimeout(() => message.delete(), 5000);
    }
  },
};
