import { SlashCommandBuilder } from "discord.js";

export default {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with Pong and shows bot statistics!"),

  async execute(interaction) {
    // Get the bot's WebSocket ping
    const wsPing = interaction.client.ws.ping;

    // Calculate API latency
    const sent = await interaction.reply({
      content: "Pinging...",
      fetchReply: true,
    });
    const apiLatency = sent.createdTimestamp - interaction.createdTimestamp;

    // Edit the reply to include stats
    await interaction.editReply(`🏓 Pong!
    - WebSocket Latency: ${wsPing}ms
    - API Latency: ${apiLatency}ms`);
  },
};
