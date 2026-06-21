import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlagsBitField,
} from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("delmes")
    .setDescription(
      "Delete all messages in the channel (max 100 per batch, within 14 days)",
    )
    .addStringOption((option) =>
      option
        .setName("amount")
        .setDescription(
          "Number of messages to delete, max 100 per batch, or 'all'",
        )
        .setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    let amount = interaction.options.getString("amount");

    try {
      await interaction.deferReply({
        flags: MessageFlagsBitField.Flags.Ephemeral,
      });

      if (
        !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
      ) {
        return interaction.editReply(
          "You do not have the required permissions to use this command!",
        );
      }

      const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
      let totalDeleted = 0;
      let hasMore = true;

      while (hasMore) {
        const fetchAmount = amount === "all" ? 100 : Number.parseInt(amount, 10);
        if (Number.isNaN(fetchAmount) || fetchAmount <= 0) {
          return interaction.editReply("Invalid amount specified.");
        }

        const messages = await interaction.channel.messages.fetch({
          limit: fetchAmount,
        });
        const filteredMessages = messages.filter(
          (msg) => msg.createdTimestamp > twoWeeksAgo,
        );

        if (filteredMessages.size === 0) {
          break;
        }

        await interaction.channel.bulkDelete(filteredMessages, true);
        totalDeleted += filteredMessages.size;

        if (amount !== "all" || filteredMessages.size < fetchAmount) {
          hasMore = false;
        }
      }

      await interaction.editReply(
        `Deleted ${totalDeleted} messages from the last 14 days!`,
      );
    } catch (error) {
      console.error("Error processing the delmes command:", error);
      if (!interaction.replied) {
        await interaction.editReply(
          "An error occurred while processing your command!",
        );
      }
    } finally {
      setTimeout(() => {
        interaction.deleteReply();
      }, 3000);
    }
  },
};
