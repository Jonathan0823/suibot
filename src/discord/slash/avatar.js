import { EmbedBuilder, MessageFlagsBitField, SlashCommandBuilder } from "discord.js";
import getRandomColor from "../../utils/randomColor.js";

export default {
  data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Get the avatar of a user")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user whose avatar you want to view")
        .setRequired(false),
    ),

  execute: async (interaction) => {
    try {
      // Defer to allow for longer processing
      await interaction.deferReply();

      const user = interaction.options.getUser("user") || interaction.user;
      const avatar = user.displayAvatarURL({ dynamic: true, size: 4096 });
      const color = getRandomColor();

      const embed = new EmbedBuilder()
        .setTitle(`${user.username}'s Avatar`)
        .setImage(avatar)
        .setColor(color)
        .setFooter({ text: `Requested by ${interaction.user.username}` });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("Error processing the avatar command:", error);

      if (!interaction.replied) {
        await interaction.reply({
          content: "An error occurred while processing your command!",
          flags: MessageFlagsBitField.Flags.Ephemeral,
        });
      }
    }
  },
};
