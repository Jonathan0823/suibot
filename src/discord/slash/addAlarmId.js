import { SlashCommandBuilder, MessageFlagsBitField } from "discord.js";
import prisma from "../../lib/prisma.js";
import { loadAlarmId, setupDailyAlarm } from "../../../utils/alarm.js";

export default {
  data: new SlashCommandBuilder()
    .setName("setupdailyalarm")
    .setDescription("Set up daily alarm for a channel")
    .addStringOption((option) =>
      option
        .setName("channelid")
        .setDescription("The channel ID")
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

    const channelId = interaction.options.getString("channelid");
    const alarmId =
      (await prisma.alarmChannel.findUnique({
        where: {
          channelId,
        },
      })) || null;
    const alarmIdExists = alarmId !== null;

    if (alarmIdExists) {
      return interaction.reply({
        content: `The channel ID "${channelId}" is already in the list!`,
        flags: MessageFlagsBitField.Flags.Ephemeral,
      });
    }

    try {
      await prisma.alarmChannel.create({
        data: {
          channelId,
        },
      });
    } catch (error) {
      console.error("Error adding channel ID:", error);
      return interaction.reply({
        content: `There was an error adding the channel ID "${channelId}"!`,
        flags: MessageFlagsBitField.Flags.Ephemeral,
      });
    }

    await loadAlarmId();
    setupDailyAlarm(interaction.client, "hoyo");
    await interaction.reply({
      content: `The channel ID "${channelId}" has been added to the list!`,
      flags: MessageFlagsBitField.Flags.Ephemeral,
    });

    setTimeout(() => {
      interaction.deleteReply();
    }, 3000);
  },
};
