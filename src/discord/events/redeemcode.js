import "dotenv/config";
import { removeWhitespace } from "../../utils/titleCase.js";
import redeemCodes from "../../modules/redeemCodes/index.js";

import { isAdmin } from "../auth.js";

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
    const gameType = redeemCodes.gameForInputChannel(message.channelId);
    if (!gameType) return;

    // Check if sender is authorized
    if (!isAdmin(message.author)) {
      await message.reply("You are not authorized to use this channel.");
      await message.delete();
      return;
    }

    try {
      const codes = parseMessage(message.content);
      await redeemCodes.broadcast(gameType, codes, { client: message.client });
    } catch (error) {
      console.error("Error processing message:", error);
      await message.reply("Error: Invalid format. Please use: code1 item1,code2 item2");
      setTimeout(() => message.delete(), 5000);
    }
  },
};
