import { REST, Routes } from "discord.js";

/** Register slash commands with Discord. Errors are logged, not thrown. */
export async function registerSlash(commands, { token, appId } = {}) {
  const rest = new REST({ version: "10" }).setToken(token);

  try {
    console.log("Started refreshing application (/) commands.");

    await rest.put(Routes.applicationCommands(appId), {
      body: commands.map((command) => command.data.toJSON()),
    });

    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error(error);
  }
}
