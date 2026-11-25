// Single source of truth for supported games and the hardcoded manual-input channels.
export const GAME_CONFIG = {
  gi: {
    name: "Genshin Impact",
    emoji: "<:genshinimpact:1324355501466849331>",
    currencyEmoji: "<:primo:1334721457883971614>",
    playerName: "Traveler",
    redeemLink: "https://genshin.hoyoverse.com/en/gift?code=",
  },
  hsr: {
    name: "Honkai Star Rail",
    emoji: "<:hsr:1324355673567395921>",
    currencyEmoji: "<:jade:1334721376635846686>",
    playerName: "Trailblazer",
    redeemLink: "https://hsr.hoyoverse.com/gift?code=",
  },
  zzz: {
    name: "Zenless Zone Zero",
    emoji: "<:zenless:1324356078825377932>",
    currencyEmoji: "<:poly:1334721545477820557>",
    playerName: "Proxy",
    redeemLink: "https://zenless.hoyoverse.com/redemption?code=",
  },
  wuwa: {
    name: "Wuthering Waves",
    emoji: "<:chixiayatta:1336876161803882586>",
    currencyEmoji: "<:astrite:1364023503195734036>",
    playerName: "Rover",
    redeemLink: null, // No web redemption for Wuwa
  },
  endfield: {
    name: "Arknights: Endfield",
    emoji: "<:endmin:1467358770135957627>",
    currencyEmoji: "<:Oroberyl:1467344972851187960>",
    playerName: "Endministrator",
    redeemLink: null,
  },
};

export const GAME_IDS = Object.keys(GAME_CONFIG);

// Channels where an authorized user manually posts codes
export const INPUT_CHANNELS = {
  "1337568739415167057": "gi",
  "1337568755462701177": "hsr",
  "1337568767395364938": "zzz",
  "1364022887022985279": "wuwa",
};
