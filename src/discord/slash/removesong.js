import { SlashCommandBuilder, MessageFlagsBitField } from "discord.js";
import songStatus from "../../modules/songStatus/index.js";
import { isAdmin } from "../auth.js";

export default {
  data: new SlashCommandBuilder()
    .setName("removesong")
    .setDescription("Removes a song from the song list")
    .addStringOption((option) =>
      option.setName("song").setDescription("The song to remove").setRequired(true),
    ),

  async execute(interaction) {
    if (!isAdmin(interaction.user)) {
      await interaction.reply({
        content: "You are not authorized to use this command.",
        flags: MessageFlagsBitField.Flags.Ephemeral,
      });
      return;
    }

    const song = interaction.options.getString("song");

    try {
      await songStatus.remove(song);
    } catch (err) {
      console.error(err);
      await interaction.reply({
        content: "There was an error deleting the song.",
        flags: MessageFlagsBitField.Flags.Ephemeral,
      });
    }

    await interaction.reply({
      content: `Song ${song} has been removed from the song list.`,
      flags: MessageFlagsBitField.Flags.Ephemeral,
    });
  },
};
