import { SlashCommandBuilder, MessageFlagsBitField } from "discord.js";
import triggerWords from "../../modules/triggerWords/index.js";
import { isAdmin } from "../auth.js";

export default {
  data: new SlashCommandBuilder()
    .setName("addtriggerword")
    .setDescription("Add a trigger word to the list")
    .addStringOption((option) =>
      option.setName("key").setDescription("The trigger key to match").setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("response").setDescription("The response to send").setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("matchmode")
        .setDescription("How to match: exact, prefix, contains, regex")
        .setRequired(false)
        .addChoices(
          { name: "exact", value: "exact" },
          { name: "prefix", value: "prefix" },
          { name: "contains", value: "contains" },
          { name: "regex", value: "regex" },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("aliases")
        .setDescription("Comma-separated alternative keys")
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName("priority")
        .setDescription("Higher priority triggers checked first")
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option.setName("cooldown").setDescription("Cooldown in seconds").setRequired(false),
    ),

  async execute(interaction) {
    if (!isAdmin(interaction.user)) {
      await interaction.reply({
        content: "You are not authorized to use this command.",
        flags: MessageFlagsBitField.Flags.Ephemeral,
      });
      return;
    }

    const key = interaction.options.getString("key");
    const response = interaction.options.getString("response");
    const matchMode = interaction.options.getString("matchmode") || "exact";
    const aliasesRaw = interaction.options.getString("aliases");
    const priority = interaction.options.getInteger("priority") || 0;
    const cooldown = interaction.options.getInteger("cooldown") || 0;

    // Parse aliases from comma-separated string
    const aliases = aliasesRaw
      ? aliasesRaw
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean)
      : [];

    const result = await triggerWords.add({
      key,
      response,
      matchMode,
      aliases,
      priority,
      cooldownSeconds: cooldown,
    });

    if (!result.ok) {
      return interaction.reply({
        content: `The trigger "${key}" already exists!`,
        flags: MessageFlagsBitField.Flags.Ephemeral,
      });
    }

    await interaction.reply({
      content: `Trigger "${key}" has been added! (mode: ${matchMode})`,
      flags: MessageFlagsBitField.Flags.Ephemeral,
    });

    setTimeout(() => {
      interaction.deleteReply();
    }, 3000);
  },
};
