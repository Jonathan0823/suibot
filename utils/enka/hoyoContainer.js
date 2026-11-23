import { MessageFlagsBitField, EmbedBuilder } from "discord.js";
import { Wrapper } from "enkanetwork.js";
import getRandomColor from "../../helper/randomColor.js";
import { getHoyoAssetsfromURL } from "./getHoyoAssetsfromURL.js";

async function hoyoContainer(message, type, id) {
  const wrapper = new Wrapper({
    cache: true,
  });

  message.deferReply({
    flags: MessageFlagsBitField.Flags.Ephemeral,
  });

  try {
    const response = await wrapper[type].getPlayer(id);
    console.log(response);

    const profilePicture = await getHoyoAssetsfromURL(
      type,
      response.player.profilePicture.assets.oldIcon ||
        response.player.profilePicture.assets.icon,
    );

    const embed = new EmbedBuilder()
      .setColor(getRandomColor())
      .setTitle(type === "genshin" ? "Genshin Impact" : "Honkai Star Rail")
      .setThumbnail(profilePicture)
      .setDescription(
        `
        Name: ${response.player?.username}
        UID: ${response?.uid}   
        World Level: ${response?.player.levels.world}
        Adventure Rank: ${response?.player.levels.rank}
        Achievements: ${response?.player.achievements}
        Latest Abyss: Floor ${response.player.abyss.floor} Chamber ${response.player.abyss.chamber}, ${response.player.abyss.stars} Stars
        `,
      );

    message.deleteReply();
    await message.channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Error processing the hoyoContainer command:", error);
    await message.editReply("An error occurred while processing the command.");
  }
}

export { hoyoContainer };
