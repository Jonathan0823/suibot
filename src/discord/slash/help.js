import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder().setName("help").setDescription("Replies with help!"),

  async execute(interaction) {
    await interaction.reply(
      "**Suisei**\n- `?sui`\n\n**Camellya**\n- `?cam`\n\n**Bocchi**\n- `?bocchi`\n\n**Yukinon**\n- `?yukinon`\n\n**Hutao**\n- `?hutao`",
    );
  },
};
