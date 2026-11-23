const TIME_ZONE = "Asia/Jakarta";
const CODE_GAMES = ["gi", "hsr", "zzz", "wuwa", "endfield"];
const SHOWCASE_GAMES = ["genshin", "starrail"];

function formatJakartaTime(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "long",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.weekday}, ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} (${TIME_ZONE}, UTC+7)`;
}

function summarizePlayer(game, response) {
  const player = response?.player ?? {};
  const lines = [
    `Game: ${game === "genshin" ? "Genshin Impact" : "Honkai Star Rail"}`,
    `Name: ${player.username}`,
    `UID: ${response?.uid}`,
    `World Level: ${player.levels?.world}`,
    `Adventure Rank: ${player.levels?.rank}`,
    `Achievements: ${player.achievements}`,
  ];
  if (player.abyss) {
    lines.push(
      `Latest Abyss: Floor ${player.abyss.floor} Chamber ${player.abyss.chamber}, ${player.abyss.stars} Stars`,
    );
  }
  return lines.join("\n");
}

/**
 * The read-only Tools every Persona gets. Each run() returns text or throws; the Tool loop
 * turns a throw into an error result for the model.
 * @param {object} deps
 * @param {(query: string) => Promise<{text: string, sources?: string[]}>} deps.search
 * @param {(game: string) => Promise<string[]>} deps.getCodes
 * @param {(game: string, uid: string) => Promise<object>} deps.getPlayer
 * @param {() => Date} [deps.now]
 */
export function createTools({ search, getCodes, getPlayer, now = () => new Date() }) {
  return [
    {
      name: "web_search",
      description:
        "Search the web for current information. Returns a short answer and source URLs.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "What to search for" } },
        required: ["query"],
      },
      async run({ query }) {
        const { text, sources = [] } = await search(String(query));
        return sources.length ? `${text}\n\nSources:\n${sources.join("\n")}` : text;
      },
    },
    {
      name: "get_current_time",
      description: "Get the current date and time in Asia/Jakarta (UTC+7).",
      parameters: { type: "object", properties: {} },
      async run() {
        return formatJakartaTime(now());
      },
    },
    {
      name: "get_redeem_codes",
      description: "List the currently active redeem codes for a game.",
      parameters: {
        type: "object",
        properties: { game: { type: "string", enum: CODE_GAMES } },
        required: ["game"],
      },
      async run({ game }) {
        if (!CODE_GAMES.includes(game)) throw new Error("unknown game");
        const codes = await getCodes(game);
        return codes.length ? codes.join("\n") : "There are no active codes for this game.";
      },
    },
    {
      name: "get_player_showcase",
      description: "Look up a Genshin Impact or Honkai Star Rail player profile by UID.",
      parameters: {
        type: "object",
        properties: {
          game: { type: "string", enum: SHOWCASE_GAMES },
          uid: { type: "string", description: "The player's UID" },
        },
        required: ["game", "uid"],
      },
      async run({ game, uid }) {
        if (!SHOWCASE_GAMES.includes(game)) throw new Error("unknown game");
        return summarizePlayer(game, await getPlayer(game, String(uid)));
      },
    },
  ];
}
