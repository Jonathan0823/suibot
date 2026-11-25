import "dotenv/config";
import "./src/lib/server.js";
import fs from "node:fs";
import path from "node:path";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ActivityType,
  MessageFlagsBitField,
} from "discord.js";
import { loadAlarmId, setupDailyAlarm, triggerAlarm } from "./utils/alarm.js";
import { getSong, updateSongList } from "./utils/songlist.js";
import { loadTriggerWords, triggerWords } from "./utils/triggerWord.js";
import { bindAlertClient } from "./src/modules/ai/discordAlert.js";
import personas from "./src/modules/personas/index.js";
import { createDefaultPersonaResponder } from "./src/modules/personas/responder.js";
import redeemCodes from "./src/modules/redeemCodes/index.js";
import { fileURLToPath, pathToFileURL } from "node:url";
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on("clientReady", async () => {
  bindAlertClient(client);
  await loadAlarmId();
  await loadTriggerWords();

  setupDailyAlarm(client, "hoyo");
  await redeemCodes.start(client);

  client.user.setActivity("新星目録", {
    type: ActivityType.Listening,
  });

  console.log(`Logged in as ${client.user.tag}!`);

  await updateSongList();

  setInterval(() => {
    const songs = getSong();
    const randomSong = songs[Math.floor(Math.random() * songs.length)];
    client.user.setActivity(randomSong, {
      type: ActivityType.Listening,
    });
  }, 1000 * 60);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

const isRuntimeModule = (file) => file.endsWith(".js") && !file.endsWith(".test.js");

const slashCommands = [];
const slashCommandMap = new Map();
const slashPath = path.join(__dirname, "src/discord/slash");
const slashFiles = fs.readdirSync(slashPath).filter(isRuntimeModule);

const eventsPath = path.join(__dirname, "src/discord/events");
const eventFiles = fs.readdirSync(eventsPath).filter(isRuntimeModule);

for (const file of slashFiles) {
  const fullPath = path.join(slashPath, file);
  const module = await import(pathToFileURL(fullPath).href);
  const command = module.default;
  slashCommands.push(command.data.toJSON());
  slashCommandMap.set(command.data.name, command);
}

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);

  const eventModule = await import(pathToFileURL(filePath).href);
  const event = eventModule.default;

  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);

try {
  console.log("Started refreshing application (/) commands.");

  await rest.put(Routes.applicationCommands(process.env.DISCORD_APP_ID), {
    body: slashCommands,
  });

  console.log("Successfully reloaded application (/) commands.");
} catch (error) {
  console.error(error);
}

const handleMessageCommand = async (interaction) => {
  const handled = await triggerWords(interaction);
  if (handled) {
    return true;
  }

  if (!interaction.content || interaction.author.bot || !interaction.content.startsWith("?")) {
    return false;
  }

  const args = interaction.content.slice(1).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();

  const persona = personas.find((entry) => entry.trigger === commandName);
  if (persona) {
    try {
      if (interaction.replied || interaction.deferred) {
        console.log("Command already processed");
        return true;
      }

      await personaResponder.reply(interaction, persona, args);
      return true;
    } catch (error) {
      console.error(`Error in message command ${commandName}:`, error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply("There was an error executing that command!");
      }
      return true;
    }
  }
  return false;
};

const handleSlashCommand = async (interaction) => {
  if (!interaction.isCommand()) return false;

  const command = slashCommandMap.get(interaction.commandName);
  if (command) {
    try {
      await command.execute(interaction);
      return true;
    } catch (error) {
      console.error(`Error in slash command ${interaction.commandName}:`, error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "There was an error executing this command!",
          flags: MessageFlagsBitField.Flags.Ephemeral,
        });
      }
      return true;
    }
  }
  return false;
};

const executeCommand = async (interaction, isSlash = true) => {
  try {
    if (!isSlash) {
      return await handleMessageCommand(interaction);
    }

    if (isSlash) {
      return await handleSlashCommand(interaction);
    }

    return false;
  } catch (globalError) {
    console.error("Global error in command execution:", globalError);
    return false;
  }
};

client.on("messageCreate", async (message) => {
  if (message.content === "!alarm") {
    const channelId = [message.channel.id];
    await triggerAlarm(message.client, channelId, "hoyo");
    message.reply("Alarm triggered for testing!");
  }
  if (message.content === "!alarmwuwa") {
    const channelId = [message.channel.id];
    await triggerAlarm(message.client, channelId, "wuwa");
    message.reply("Alarm triggered for testing!");
  }
  await executeCommand(message, false);
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isAutocomplete()) {
    const command = slashCommandMap.get(interaction.commandName);
    if (command?.autocomplete) {
      try {
        await command.autocomplete(interaction);
      } catch (error) {
        console.error(`Error in autocomplete for ${interaction.commandName}:`, error);
      }
    }
    return;
  }
  if (!interaction.isCommand()) return;

  console.log("InteractionCreate Event - Processing Slash Command");
  await executeCommand(interaction, true);
});

client.login(process.env.DISCORD_BOT_TOKEN);
