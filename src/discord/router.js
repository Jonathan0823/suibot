import { MessageFlagsBitField } from "discord.js";

/**
 * Routes Discord events to modules and slash commands.
 * @param {{
 *  triggerWords: { match: Function },
 *  personas: Array<{trigger: string}>,
 *  personaResponder: { reply: Function },
 *  alarms: { fire: Function },
 *  slashCommands: Array<any>,
 *  isAdmin: (user: any) => boolean,
 * }} deps
 */
export function createRouter({
  triggerWords,
  personas,
  personaResponder,
  alarms,
  slashCommands,
  isAdmin,
}) {
  const personaMap = new Map(personas.map((persona) => [persona.trigger, persona]));
  const slashMap = new Map(slashCommands.map((command) => [command.data.name, command]));

  const routePersona = async (message) => {
    if (!message.content || message.author.bot || !message.content.startsWith("?")) {
      return false;
    }

    const args = message.content.slice(1).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();
    const persona = personaMap.get(commandName);
    if (!persona) return false;

    try {
      if (message.replied || message.deferred) {
        console.log("Command already processed");
        return true;
      }

      await personaResponder.reply(message, persona, args);
    } catch (error) {
      console.error(`Error in message command ${commandName}:`, error);

      if (!message.replied && !message.deferred) {
        await message.reply("There was an error executing that command!");
      }
    }
    return true;
  };

  const routeDebugAlarm = async (message) => {
    const type =
      message.content === "!alarm" ? "hoyo" : message.content === "!alarmwuwa" ? "wuwa" : null;
    if (!type || !isAdmin(message.author)) return false;

    await alarms.fire(type, [message.channel.id], message.client);
    message.reply("Alarm triggered for testing!");
    return true;
  };

  const onMessage = async (message) => {
    try {
      if (await routeDebugAlarm(message)) return true;
      if (await triggerWords.match(message)) return true;
      return await routePersona(message);
    } catch (globalError) {
      console.error("Global error in command execution:", globalError);
      return false;
    }
  };

  const onInteraction = async (interaction) => {
    if (interaction.isAutocomplete()) {
      const command = slashMap.get(interaction.commandName);
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
    const command = slashMap.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Error in slash command ${interaction.commandName}:`, error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "There was an error executing this command!",
          flags: MessageFlagsBitField.Flags.Ephemeral,
        });
      }
    }
  };

  return { onMessage, onInteraction };
}
