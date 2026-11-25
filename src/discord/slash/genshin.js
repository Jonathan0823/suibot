import { SlashCommandBuilder } from "discord.js";
import { hoyoContainer } from "../hoyoContainer.js";

export default {
  data: new SlashCommandBuilder()
    .setName("genshin")
    .setDescription("Genshin Impact related commands")
    .addStringOption((option) =>
      option.setName("id").setDescription("The ID of the account you want to view"),
    ),
  async execute(interaction) {
    await hoyoContainer(interaction, "genshin", interaction.options.getString("id"));
  },
};
