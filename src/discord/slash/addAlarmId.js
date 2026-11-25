import { SlashCommandBuilder, MessageFlagsBitField } from "discord.js";
import alarms from "../../modules/alarms/index.js";
import { isAdmin } from "../auth.js";

export default {
  data: new SlashCommandBuilder()
    .setName("setupdailyalarm")
    .setDescription("Set up daily alarm for a channel")
    .addStringOption((option) =>
      option.setName("channelid").setDescription("The channel ID").setRequired(true),
    ),

  async execute(interaction) {
    if (!isAdmin(interaction.user)) {
      await interaction.reply({
        content: "You are not authorized to use this command.",
        flags: MessageFlagsBitField.Flags.Ephemeral,
      });
      return;
    }

    const channelId = interaction.options.getString("channelid");
    let result;
    try {
      result = await alarms.addChannel(channelId, interaction.client);
    } catch (error) {
      console.error("Error adding channel ID:", error);
      return interaction.reply({
        content: `There was an error adding the channel ID "${channelId}"!`,
        flags: MessageFlagsBitField.Flags.Ephemeral,
      });
    }

    if (!result.ok) {
      return interaction.reply({
        content: `The channel ID "${channelId}" is already in the list!`,
        flags: MessageFlagsBitField.Flags.Ephemeral,
      });
    }

    await interaction.reply({
      content: `The channel ID "${channelId}" has been added to the list!`,
      flags: MessageFlagsBitField.Flags.Ephemeral,
    });

    setTimeout(() => {
      interaction.deleteReply();
    }, 3000);
  },
};
