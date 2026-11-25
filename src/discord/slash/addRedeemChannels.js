import { MessageFlagsBitField, SlashCommandBuilder } from "discord.js";
import redeemCodes from "../../modules/redeemCodes/index.js";

export default {
  data: new SlashCommandBuilder()
    .setName("addredeemchannels")
    .setDescription("Add channels to redeem code tracking.")
    .addStringOption((option) =>
      option
        .setName("channel")
        .setDescription("The channel to add.")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("game")
        .setDescription("The game to add.")
        .setRequired(true),
    ),

  async execute(interaction) {
    const sender = interaction.user.username;

    if (sender !== "lynz727wysi") {
      await interaction.reply({
        content: "You are not authorized to use this command.",
        flags: MessageFlagsBitField.Flags.Ephemeral,
      });
      return;
    }

    const channelId = interaction.options.getString("channel");
    const game = interaction.options.getString("game");

    try {
      await redeemCodes.addChannel(game, channelId);
    } catch (error) {
      console.error("Error adding channel ID:", error);
      return interaction.reply({
        content: `There was an error adding the channel ID "${channelId}"!`,
        flags: MessageFlagsBitField.Flags.Ephemeral,
      });
    }

    await interaction.reply({
      content: `The channel ID "${channelId}" with game type "${game}" has been added to the list!`,
    });
  },
};
