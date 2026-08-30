import { ChannelType, MessageFlagsBitField, SlashCommandBuilder } from "discord.js";
import prisma from "../lib/prisma.js";
import { clearProviderCredentialCache, loadAiConfig, PROVIDER_TYPES } from "../utils/ai/config.js";
import { encryptApiKey } from "../utils/ai/crypto.js";
import { AiProviderError, createAiProviderService } from "../utils/ai/providers.js";
import { logAiEvent } from "../utils/ai/observability.js";

const EPHEMERAL = MessageFlagsBitField.Flags.Ephemeral;

export function isAuthorized(interaction) {
  const ids = (process.env.AI_ADMIN_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.includes(interaction.user.id);
}

function safeText(value) {
  return String(value || "")
    .replace(/[\r\n`]/g, "")
    .slice(0, 120);
}

function providerTypeOption(option) {
  return option
    .setName("type")
    .setDescription("Provider protocol")
    .setRequired(true)
    .addChoices(
      { name: "Gemini", value: PROVIDER_TYPES.GEMINI },
      { name: "OpenAI-compatible", value: PROVIDER_TYPES.OPENAI_COMPATIBLE },
    );
}

function nameOption(option, required = true) {
  return option.setName("name").setDescription("Provider name").setRequired(required);
}

function modelOption(option, required = true) {
  return option.setName("model").setDescription("Model identifier").setRequired(required);
}

function baseUrlOption(option, required = false) {
  return option.setName("base-url").setDescription("Provider API base URL").setRequired(required);
}

function priorityOption(option) {
  return option
    .setName("priority")
    .setDescription("Lower numbers are tried first")
    .setMinValue(0)
    .setRequired(false);
}

function apiKeyOption(option, required = false) {
  return option
    .setName("api-key")
    .setDescription("Provider API key; never echoed or logged")
    .setRequired(required);
}

async function reply(interaction, content) {
  await interaction.reply({
    content,
    flags: EPHEMERAL,
    allowedMentions: { parse: [] },
  });
}

async function handleAdd(interaction) {
  const name = interaction.options.getString("name").trim();
  const type = interaction.options.getString("type");
  const model = interaction.options.getString("model").trim();
  const baseUrl = interaction.options.getString("base-url")?.trim() || null;
  const apiKey = interaction.options.getString("api-key");
  const priority = interaction.options.getInteger("priority") ?? 100;

  if (!name || !model) return reply(interaction, "Provider name and model are required.");
  if (type === PROVIDER_TYPES.OPENAI_COMPATIBLE && (!baseUrl || !apiKey)) {
    return reply(interaction, "OpenAI-compatible providers require a base URL and API key.");
  }
  if (type === PROVIDER_TYPES.GEMINI && (apiKey || baseUrl)) {
    return reply(interaction, "Gemini uses the existing API_KEY environment variable.");
  }

  const credentials = apiKey ? encryptApiKey(apiKey) : {};
  await prisma.aiProvider.create({
    data: {
      name,
      type,
      model,
      baseUrl: type === PROVIDER_TYPES.GEMINI ? null : baseUrl,
      apiKeyCiphertext: credentials.ciphertext,
      apiKeyIv: credentials.iv,
      apiKeyAuthTag: credentials.authTag,
      priority,
    },
  });
  await reply(interaction, `Provider "${safeText(name)}" added.`);
}

export function buildProviderUpdateData({ model, baseUrl, priority, credentials }) {
  const data = {};
  if (model) data.model = model.trim();
  if (baseUrl) data.baseUrl = baseUrl.trim();
  if (priority !== null) data.priority = priority;
  if (credentials) Object.assign(data, credentials);
  return data;
}

export function getCredentialLabel(provider) {
  if (provider.type === PROVIDER_TYPES.GEMINI) return "API_KEY env";
  if (provider.apiKeyCiphertext) return "encrypted key";
  return "missing key";
}

export function isTextChannel(channel) {
  return channel?.isTextBased() === true;
}

async function handleUpdate(interaction) {
  const name = interaction.options.getString("name").trim();
  const provider = await prisma.aiProvider.findUnique({ where: { name } });
  if (!provider) return reply(interaction, `Provider "${safeText(name)}" was not found.`);

  const model = interaction.options.getString("model");
  const baseUrl = interaction.options.getString("base-url");
  const apiKey = interaction.options.getString("api-key");
  const priority = interaction.options.getInteger("priority");

  if (provider.type === PROVIDER_TYPES.GEMINI && (baseUrl || apiKey)) {
    return reply(interaction, "Gemini uses the existing API_KEY environment variable.");
  }
  if (provider.type === PROVIDER_TYPES.OPENAI_COMPATIBLE && baseUrl === "") {
    return reply(interaction, "The base URL cannot be empty.");
  }

  let credentials = null;
  if (apiKey) {
    const encrypted = encryptApiKey(apiKey);
    credentials = {
      apiKeyCiphertext: encrypted.ciphertext,
      apiKeyIv: encrypted.iv,
      apiKeyAuthTag: encrypted.authTag,
    };
  }
  await prisma.aiProvider.update({
    where: { name },
    data: buildProviderUpdateData({ model, baseUrl, priority, credentials }),
  });
  clearProviderCredentialCache(provider.id);
  await reply(interaction, `Provider "${safeText(name)}" updated.`);
}

async function handleRemove(interaction) {
  const name = interaction.options.getString("name").trim();
  const provider = await prisma.aiProvider.findUnique({ where: { name } });
  if (!provider) return reply(interaction, `Provider "${safeText(name)}" was not found.`);

  await prisma.aiProvider.delete({ where: { name } });
  clearProviderCredentialCache(provider.id);
  await reply(interaction, `Provider "${safeText(name)}" removed.`);
}

async function handleSetEnabled(interaction, enabled) {
  const name = interaction.options.getString("name").trim();
  const provider = await prisma.aiProvider.findUnique({ where: { name } });
  if (!provider) return reply(interaction, `Provider "${safeText(name)}" was not found.`);

  await prisma.aiProvider.update({ where: { name }, data: { enabled } });
  await reply(interaction, `Provider "${safeText(name)}" ${enabled ? "enabled" : "disabled"}.`);
}

async function handleList(interaction) {
  await loadAiConfig();
  const providers = await prisma.aiProvider.findMany({
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  if (providers.length === 0) return reply(interaction, "No AI providers are configured.");

  const lines = providers.map((provider) => {
    const credential = getCredentialLabel(provider);
    return `${provider.priority}. ${safeText(provider.name)} | ${safeText(provider.type)} | ${safeText(provider.model)} | ${provider.enabled ? "enabled" : "disabled"} | ${credential}`;
  });
  await reply(interaction, lines.join("\n"));
}

async function handleTest(interaction) {
  await loadAiConfig();
  const name = interaction.options.getString("name").trim();
  const service = createAiProviderService();
  const result = await service.testProvider(name);
  logAiEvent("ai_provider_test", {
    provider: result.provider,
    model: result.model,
    status: "success",
    durationMs: result.durationMs,
  });
  await reply(
    interaction,
    `Provider "${safeText(result.provider)}" responded successfully using model "${safeText(result.model)}" in ${result.durationMs}ms.`,
  );
}

async function handleSetLogChannel(interaction) {
  const channel = interaction.options.getChannel("channel");
  if (!isTextChannel(channel)) {
    return reply(interaction, "The operations channel must be text-based.");
  }

  await prisma.aiSettings.upsert({
    where: { id: 1 },
    update: { operationsChannelId: channel.id },
    create: { id: 1, operationsChannelId: channel.id },
  });
  await reply(interaction, `AI failure notifications will use <#${channel.id}>.`);
}

export default {
  data: new SlashCommandBuilder()
    .setName("ai-provider")
    .setDescription("Manage global AI providers")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add a provider")
        .addStringOption((option) => nameOption(option))
        .addStringOption((option) => providerTypeOption(option))
        .addStringOption((option) => modelOption(option))
        .addStringOption((option) => baseUrlOption(option))
        .addStringOption((option) => apiKeyOption(option))
        .addIntegerOption((option) => priorityOption(option)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("update")
        .setDescription("Update a provider")
        .addStringOption((option) => nameOption(option))
        .addStringOption((option) => modelOption(option, false))
        .addStringOption((option) => baseUrlOption(option))
        .addStringOption((option) => apiKeyOption(option))
        .addIntegerOption((option) => priorityOption(option)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove a provider")
        .addStringOption((option) => nameOption(option)),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription("List providers without exposing credentials"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("enable")
        .setDescription("Enable a provider")
        .addStringOption((option) => nameOption(option)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("disable")
        .setDescription("Disable a provider")
        .addStringOption((option) => nameOption(option)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("test")
        .setDescription("Test a provider")
        .addStringOption((option) => nameOption(option)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set-log-channel")
        .setDescription("Set the private AI failure notification channel")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Text channel for all-provider failure alerts")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        ),
    ),

  async execute(interaction) {
    if (!isAuthorized(interaction)) {
      return reply(interaction, "You are not authorized to use this command.");
    }

    const subcommand = interaction.options.getSubcommand();
    try {
      if (subcommand === "add") return await handleAdd(interaction);
      if (subcommand === "update") return await handleUpdate(interaction);
      if (subcommand === "remove") return await handleRemove(interaction);
      if (subcommand === "list") return await handleList(interaction);
      if (subcommand === "enable") return await handleSetEnabled(interaction, true);
      if (subcommand === "disable") return await handleSetEnabled(interaction, false);
      if (subcommand === "test") return await handleTest(interaction);
      if (subcommand === "set-log-channel") return await handleSetLogChannel(interaction);
    } catch (error) {
      logAiEvent("ai_admin_command_failed", {
        command: subcommand,
        errorType: error instanceof AiProviderError ? error.errorType : "operation_failed",
      });
      await reply(interaction, "The AI provider operation failed. Check the application logs.");
    }
  },
};
