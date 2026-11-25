import { SlashCommandBuilder, MessageFlagsBitField } from "discord.js";
import triggerWords from "../../modules/triggerWords/index.js";
import { isAdmin } from "../auth.js";

export default {
  data: new SlashCommandBuilder()
    .setName("deletetriggerword")
    .setDescription("Delete a trigger word from the list")
    .addStringOption((option) =>
      option.setName("key").setDescription("The word to delete").setRequired(true),
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

    try {
      const deleted = await triggerWords.remove(key);

      if (!deleted) {
        await interaction.reply({
          content: `The trigger word "${key}" does not exist.`,
          flags: MessageFlagsBitField.Flags.Ephemeral,
        });

        return;
      }

      await interaction.reply({
        content: `The trigger word "${key}" has been deleted.`,
        flags: MessageFlagsBitField.Flags.Ephemeral,
      });
    } catch (err) {
      console.error(err);
      await interaction.reply({
        content: "There was an error deleting the trigger word.",
        flags: MessageFlagsBitField.Flags.Ephemeral,
      });
    } finally {
      setTimeout(() => {
        interaction.deleteReply();
      }, 3000);
    }
  },
};
