import "dotenv/config";
import "./src/lib/server.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ActivityType, Client, GatewayIntentBits } from "discord.js";
import { loadDirectory, registerEvents } from "./src/discord/loader.js";
import { registerSlash } from "./src/discord/registerSlash.js";
import { createRouter } from "./src/discord/router.js";
import alarms from "./src/modules/alarms/index.js";
import personas from "./src/modules/personas/index.js";
import { createDefaultPersonaResponder } from "./src/modules/personas/responder.js";
import redeemCodes from "./src/modules/redeemCodes/index.js";
import songStatus from "./src/modules/songStatus/index.js";
import triggerWords from "./src/modules/triggerWords/index.js";
import { bindAlertClient } from "./src/modules/ai/discordAlert.js";

const root = path.dirname(fileURLToPath(import.meta.url));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Built on the first persona reply, not at boot; a failed build is retried on the next reply.
let personaResponderReady = null;
const personaResponder = {
  reply: async (message, persona, args) => {
    personaResponderReady ??= createDefaultPersonaResponder().catch((error) => {
      personaResponderReady = null;
      throw error;
    });
    return (await personaResponderReady).reply(message, persona, args);
  },
};
const slashCommands = await loadDirectory(path.join(root, "src/discord/slash"));
registerEvents(client, await loadDirectory(path.join(root, "src/discord/events")));

const router = createRouter({
  triggerWords,
  personas,
  personaResponder,
  alarms,
  slashCommands,
});

client.on("messageCreate", router.onMessage);
client.on("interactionCreate", router.onInteraction);

const startModule = async (name, start) => {
  try {
    await start();
  } catch (error) {
    console.error(`Failed to start ${name}:`, error);
  }
};

client.on("clientReady", async () => {
  bindAlertClient(client);
  await startModule("alarms", () => alarms.start(client));
  await startModule("trigger words", () => triggerWords.start());

  await startModule("redeem codes", () => redeemCodes.start(client));

  client.user.setActivity("新星目録", {
    type: ActivityType.Listening,
  });

  console.log(`Logged in as ${client.user.tag}!`);

  await startModule("song status", () => songStatus.start(client));
});

await registerSlash(slashCommands, {
  token: process.env.DISCORD_BOT_TOKEN,
  appId: process.env.DISCORD_APP_ID,
});

client.login(process.env.DISCORD_BOT_TOKEN);
