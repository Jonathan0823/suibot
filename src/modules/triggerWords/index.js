import defaultPrisma from "../../lib/prisma.js";

// Match modes
const matchExact = (input, pattern) => input === pattern;
const matchPrefix = (input, pattern) => input.startsWith(pattern);
const matchContains = (input, pattern) => input.includes(pattern);
const matchRegex = (input, pattern) => {
  try {
    return new RegExp(pattern, "i").test(input);
  } catch {
    return false;
  }
};

const getMatchFn = (mode) => {
  switch (mode) {
    case "prefix":
      return matchPrefix;
    case "contains":
      return matchContains;
    case "regex":
      return matchRegex;
    case "exact":
    default:
      return matchExact;
  }
};

// Find matching trigger
const findMatchingTrigger = (triggers, normalizedInput) => {
  for (const trigger of triggers) {
    const matchFn = getMatchFn(trigger.matchMode);

    // Check primary key
    if (matchFn(normalizedInput, trigger.key)) {
      return trigger;
    }

    // Check aliases
    if (trigger.aliases && trigger.aliases.length > 0) {
      for (const alias of trigger.aliases) {
        if (matchFn(normalizedInput, alias)) {
          return trigger;
        }
      }
    }
  }

  return null;
};

const shouldSkipInteraction = (interaction) => {
  return !interaction.content || interaction.author?.bot;
};

const applyCooldown = (cooldownCache, trigger, userId) => {
  if (trigger.cooldownSeconds <= 0 || !userId) return false;

  const cooldownKey = `${trigger.id}:${userId}`;
  const lastTrigger = cooldownCache.get(cooldownKey);
  const expiry = trigger.cooldownSeconds * 1000;

  if (lastTrigger && Date.now() - lastTrigger < expiry) {
    return true; // Still on cooldown
  }

  // Set cooldown start timestamp
  cooldownCache.set(cooldownKey, Date.now());

  // Cleanup old entries periodically
  if (cooldownCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of cooldownCache.entries()) {
      if (now - v >= expiry) cooldownCache.delete(k);
    }
  }

  return false; // Not on cooldown
};

/**
 * Trigger word module: owns the DB rows and their in-memory copy.
 * @param {{ prisma: any }} deps
 */
export function createTriggerWords({ prisma } = {}) {
  let triggers = [];
  const cooldownCache = new Map();

  const load = async () => {
    try {
      const rows = await prisma.triggerWord.findMany({
        where: { enabled: true },
        orderBy: { priority: "desc" },
      });

      // Normalize keys on load (skip for regex to preserve pattern)
      triggers = rows.map((t) => {
        const isRegex = t.matchMode === "regex";

        return {
          ...t,
          key: isRegex ? t.key.trim() : t.key.trim().toLowerCase(),
          aliases: isRegex
            ? (t.aliases || []).map((a) => a.trim())
            : (t.aliases || []).map((a) => a.trim().toLowerCase()),
        };
      });

      console.log(`Loaded ${triggers.length} trigger words`);
    } catch (err) {
      console.error("Failed to load triggers:", err);
      triggers = [];
    }
  };

  /** Initial load. */
  const start = () => load();

  /**
   * Create a trigger and refresh the cache.
   * @returns {Promise<{ok: boolean, reason?: "exists"}>}
   */
  const add = async ({
    key,
    response,
    matchMode = "exact",
    aliases = [],
    priority = 0,
    cooldownSeconds = 0,
  }) => {
    const normalizedKey = key.toLowerCase().trim();
    const existing = await prisma.triggerWord.findUnique({
      where: { key: normalizedKey },
    });

    if (existing) return { ok: false, reason: "exists" };

    await prisma.triggerWord.create({
      data: {
        key: normalizedKey,
        response,
        matchMode,
        aliases,
        priority,
        cooldownSeconds,
      },
    });

    await load();
    return { ok: true };
  };

  /**
   * Delete a trigger by exact key and refresh the cache.
   * @returns {Promise<boolean>} false when the key does not exist
   */
  const remove = async (key) => {
    const triggerWord = await prisma.triggerWord.findUnique({
      where: { key },
    });

    if (!triggerWord) return false;

    await prisma.triggerWord.delete({
      where: { key },
    });

    await load();
    return true;
  };

  /** Reply to a message if it matches a trigger. null = no reply, true = sent, false = send failed. */
  const match = async (interaction) => {
    if (shouldSkipInteraction(interaction)) return null;

    // Normalize input
    const normalizedInput = interaction.content.trim().toLowerCase();

    // Find matching trigger
    const trigger = findMatchingTrigger(triggers, normalizedInput);

    if (!trigger) return null;

    // Check cooldown (if configured)
    const userId = interaction.author?.id;
    if (applyCooldown(cooldownCache, trigger, userId)) {
      return null;
    }

    // Send response
    try {
      await interaction.channel.send(trigger.response);
      return true;
    } catch (err) {
      console.error("Failed to send trigger response:", err);
      return false;
    }
  };

  return { start, add, remove, match };
}

export default createTriggerWords({ prisma: defaultPrisma });
