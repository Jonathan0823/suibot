import nodeCron from "node-cron";
import getRandomColor from "../../utils/randomColor.js";
import defaultPrisma from "../../lib/prisma.js";
import { buildHoyoActionRow, buildHoyoEmbed, buildWuwaEmbed } from "./embeds.js";

const DEFAULT_SCHEDULED_TYPES = ["hoyo"];

async function sendAlarmToChannel(channel, type, getColor) {
  const maxRetries = 3;
  let attempts = 0;
  let success = false;

  while (attempts < maxRetries && !success) {
    try {
      const color = getColor();

      if (type === "hoyo") {
        const row = buildHoyoActionRow();
        const embed = buildHoyoEmbed(color);
        await channel.send({ embeds: [embed], components: [row] });
      } else {
        const embed = buildWuwaEmbed(color);
        await channel.send({ embeds: [embed] });
      }
      success = true;
      console.log(`Alarm sent successfully! (retry = ${attempts}, clientId = ${channel.id})`);
    } catch (error) {
      attempts++;
      console.log(`Error sending alarm (attempt ${attempts}/${maxRetries}):`, error);

      if (attempts >= maxRetries) {
        console.log("Failed to send alarm after maximum retries.");
      }
    }
  }
}

async function triggerAlarm(client, channelIds, type, getColor) {
  if (!Array.isArray(channelIds)) {
    console.error("channelId must be an array of IDs.");
    return;
  }

  for (const id of channelIds) {
    const channel = await client.channels.fetch(id);
    if (!channel) {
      console.error(`Channel with ID ${id} not found.`);
      continue;
    }

    if (!channel.isTextBased() || !channel.viewable) {
      console.error(`Bot does not have access to channel: ${id}`);
      continue;
    }

    await sendAlarmToChannel(channel, type, getColor);
  }
}

/**
 * Daily alarm module: owns the alarm channel list and the cron jobs.
 * @param {{ prisma: any, cron?: { schedule: Function }, getColor?: () => any, scheduledTypes?: string[] }} deps
 */
export function createAlarms({
  prisma,
  cron = nodeCron,
  getColor = getRandomColor,
  scheduledTypes = DEFAULT_SCHEDULED_TYPES,
} = {}) {
  let channelId = [];
  const scheduledJobs = {};
  let defaultClient = null;

  const load = async () => {
    try {
      channelId = [];
      const ids = await prisma.alarmChannel.findMany();
      channelId = ids.map((id) => id.channelId);

      console.log("Alarm IDs loaded successfully.");
      return channelId;
    } catch (error) {
      console.error("Error fetching alarm IDs:", error);
      return [];
    }
  };

  const schedule = (client, type) => {
    console.log("Setting up daily alarm for " + channelId + " with type: " + type);

    if (scheduledJobs[type]) {
      scheduledJobs[type].stop();
      console.log(`Previous cron job for ${type} stopped.`);
    }

    const expression = type === "hoyo" ? "0 4 * * *" : "0 3 * * *";

    scheduledJobs[type] = cron.schedule(
      expression,
      async () => {
        await triggerAlarm(client, channelId, type, getColor);
      },
      {
        timezone: "Asia/Jakarta",
      },
    );

    console.log(`New cron job for ${type} started.`);
  };

  /** Load channels and schedule the daily alarm types (hoyo only by default). */
  const start = async (client) => {
    defaultClient = client;
    await load();
    for (const type of scheduledTypes) schedule(client, type);
  };

  /**
   * Register a channel, reload the list and re-arm the scheduled alarm types.
   * Throws if the write fails.
   * @returns {Promise<{ok: boolean, reason?: "exists"}>}
   */
  const addChannel = async (id, client = defaultClient) => {
    const existing =
      (await prisma.alarmChannel.findUnique({
        where: {
          channelId: id,
        },
      })) || null;

    if (existing !== null) return { ok: false, reason: "exists" };

    await prisma.alarmChannel.create({
      data: {
        channelId: id,
      },
    });

    await load();
    for (const type of scheduledTypes) schedule(client, type);
    return { ok: true };
  };

  /** Send an alarm of the given type now (debug commands). */
  const fire = (type, channelIds, client = defaultClient) =>
    triggerAlarm(client, channelIds, type, getColor);

  return { start, addChannel, fire };
}

export default createAlarms({ prisma: defaultPrisma });
