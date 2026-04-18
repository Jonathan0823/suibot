import prisma from "../lib/prisma.js";

// In-memory trigger cache
let triggers = [];
let cooldownCache = new Map();

const loadTriggerWords = async () => {
  try {
    const triggerWords = await prisma.triggerWord.findMany({
      where: { enabled: true },
      orderBy: { priority: "desc" },
    });

    // Normalize keys on load
    triggers = triggerWords.map((t) => ({
      ...t,
      key: t.key.trim().toLowerCase(),
      aliases: (t.aliases || []).map((a) => a.trim().toLowerCase()),
    }));

    console.log(`Loaded ${triggers.length} trigger words`);
  } catch (err) {
    console.error("Failed to load triggers:", err);
    triggers = [];
  }
};

const reloadTriggerWords = async () => {
  await loadTriggerWords();
};

// Check if trigger is on cooldown
const isOnCooldown = (triggerId, userId) => {
  const key = `${triggerId}:${userId}`;
  const lastTrigger = cooldownCache.get(key);
  
  if (!lastTrigger) return false;
  
  return Date.now() - lastTrigger < trigger.cooldownSeconds * 1000;
};

// Set cooldown for trigger
const setCooldown = (triggerId, userId) => {
  const key = `${triggerId}:${userId}`;
  cooldownCache.set(key, Date.now());
  
  // Cleanup old entries periodically
  if (cooldownCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of cooldownCache.entries()) {
      if (now - v > 60000) cooldownCache.delete(k);
    }
  }
};

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
const findMatchingTrigger = (normalizedInput) => {
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

const triggerWords = async (interaction) => {
  // Skip if no content or bot message
  if (!interaction.content || interaction.author?.bot) return null;

  // Normalize input
  const normalizedInput = interaction.content.trim().toLowerCase();

  // Find matching trigger
  const trigger = findMatchingTrigger(normalizedInput);

  if (!trigger) return null;

  // Check cooldown (if configured)
  const userId = interaction.author?.id;
  if (trigger.cooldownSeconds > 0 && userId) {
    const cooldownKey = `${trigger.id}:${userId}`;
    const lastTrigger = cooldownCache.get(cooldownKey);
    
    if (lastTrigger && Date.now() - lastTrigger < trigger.cooldownSeconds * 1000) {
      return null; // Still on cooldown
    }
    
    // Set cooldown
    cooldownCache.set(cooldownKey, Date.now());
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

export { triggerWords, loadTriggerWords, reloadTriggerWords };