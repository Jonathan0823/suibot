import songStatus from "../../modules/songStatus/index.js";

const channelId = "1347471345356767294";
export default {
  name: "messageCreate",
  async execute(message) {
    const isSongChannel = message.channel.id === channelId;

    if (!isSongChannel) return;

    const song = message.content;
    if (!song) return;

    try {
      await songStatus.add(song);

      await message.react("✅");
    } catch (err) {
      console.error("Error in adding song:", err);
    }
  },
};
