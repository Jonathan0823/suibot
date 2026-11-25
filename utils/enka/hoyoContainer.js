import { MessageFlagsBitField, EmbedBuilder } from "discord.js";
import getRandomColor from "../../helper/randomColor.js";
import { getEnkaService } from "./enkaClient.js";

function profileLines(type, profile) {
  const { player, uid } = profile;
  if (type === "starrail") {
    return [
      `Name: ${player.username}`,
      `UID: ${uid}`,
      `Trailblazer Level: ${player.level}`,
      `Equilibrium Level: ${player.equilibriumLevel}`,
      `Achievements: ${player.recordInfo?.achievementCount}`,
    ];
  }
  const lines = [
    `Name: ${player.username}`,
    `UID: ${uid}`,
    `World Level: ${player.levels?.world}`,
    `Adventure Rank: ${player.levels?.rank}`,
    `Achievements: ${player.achievements}`,
  ];
  if (player.abyss) {
    lines.push(
      `Latest Abyss: Floor ${player.abyss.floor} Chamber ${player.abyss.chamber}, ${player.abyss.stars} Stars`,
    );
  }
  return lines;
}

function failureReply(error) {
  if (error?.name === "InvalidUidFormatError") return "That doesn't look like a valid UID.";
  if (error?.name === "UserNotFoundError") return "No player was found with that UID.";
  return "An error occurred while processing the command.";
}

async function hoyoContainer(message, type, id) {
  await message.deferReply({
    flags: MessageFlagsBitField.Flags.Ephemeral,
  });

  try {
    const profile = await getEnkaService().getPlayer(type, id);

    const embed = new EmbedBuilder()
      .setColor(getRandomColor())
      .setTitle(type === "genshin" ? "Genshin Impact" : "Honkai Star Rail")
      .setDescription(profileLines(type, profile).join("\n"));
    if (profile.player.profilePictureUrl) embed.setThumbnail(profile.player.profilePictureUrl);

    await message.channel.send({ embeds: [embed] });
    await message.deleteReply().catch(() => {});
  } catch (error) {
    console.error("Error processing the hoyoContainer command:", error);
    await message.editReply(failureReply(error)).catch(() => {});
  }
}

export { hoyoContainer };
