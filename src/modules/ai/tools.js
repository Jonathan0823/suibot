const TIME_ZONE = "Asia/Jakarta";
const CODE_GAMES = ["gi", "hsr", "zzz", "wuwa", "endfield"];
const SHOWCASE_GAMES = ["genshin", "starrail"];
const MAX_CODES_SHOWN = 10;

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

const PRIVATE_SHOWCASE_LINE = "Showcase: private or empty — do not guess this player's characters.";

function formatCharacter(character, bonusLabel, bonus) {
  const parts = [character?.name ?? "Unknown"];
  if (character?.level != null) parts.push(`Lv.${character.level}`);
  if (character?.element) parts.push(character.element);
  if (bonus != null) parts.push(`${bonusLabel}${bonus}`);
  return `- ${parts.join(", ")}`;
}

function showcaseLines(characters, bonusLabel, bonusKey) {
  const list = Array.isArray(characters) ? characters : [];
  if (!list.length) return [PRIVATE_SHOWCASE_LINE];
  return [
    "Showcase characters:",
    ...list.map((c) => formatCharacter(c, bonusLabel, bonusKey ? c?.[bonusKey] : null)),
  ];
}

function summarizePlayer(game, response) {
  const player = response?.player ?? {};
  if (game === "starrail") {
    return [
      "Game: Honkai Star Rail",
      `Name: ${player.username}`,
      `UID: ${response?.uid}`,
      `Trailblazer Level: ${player.level}`,
      `Equilibrium Level: ${player.equilibriumLevel}`,
      `Achievements: ${player.recordInfo?.achievementCount}`,
      ...showcaseLines(response?.characters, "E", "eidolons"),
    ].join("\n");
  }
  const lines = [
    "Game: Genshin Impact",
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
  const showConstellations = player.publicConstellations !== false;
  lines.push(...showcaseLines(player.showcase, "C", showConstellations ? "constellations" : null));
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
        "Search the web for current information, such as news, current events, game updates, or anything that may have changed. Use it instead of answering from memory. Returns a short answer and source URLs.",
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
      description:
        "Get the current date and time in Asia/Jakarta (UTC+7). Use whenever the answer depends on the current date or time.",
      parameters: { type: "object", properties: {} },
      async run() {
        return formatJakartaTime(now());
      },
    },
    {
      name: "get_redeem_codes",
      description:
        "List the currently active redeem codes for a game. Always call this whenever a member asks about redeem codes; never list codes from memory, since codes expire. Game enum: gi = Genshin Impact, hsr = Honkai Star Rail, zzz = Zenless Zone Zero, wuwa = Wuthering Waves, endfield = Arknights: Endfield. For any other game, tell the member you can't check it and do not list codes.",
      parameters: {
        type: "object",
        properties: { game: { type: "string", enum: CODE_GAMES } },
        required: ["game"],
      },
      async run({ game }) {
        if (!CODE_GAMES.includes(game)) throw new Error("unknown game");
        const codes = await getCodes(game);
        if (!codes.length)
          return "There are no active codes for this game. Tell the member there are none right now; do not make any up.";
        // getCodes is oldest first; show the newest codes, newest first.
        const lines = codes.slice(-MAX_CODES_SHOWN).reverse();
        if (codes.length > MAX_CODES_SHOWN)
          lines.push(`Showing the ${MAX_CODES_SHOWN} newest of ${codes.length} active codes.`);
        return lines.join("\n");
      },
    },
    {
      name: "get_player_showcase",
      description:
        "Look up a Genshin Impact or Honkai Star Rail player profile and showcase characters (name, level, element, constellations or eidolons) by UID. Use only a UID the member gave in this Conversation; if none was given, ask them for it. Never guess a UID, player stats, or characters.",
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
