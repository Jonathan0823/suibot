import { randomUUID } from "node:crypto";

const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
let lastFailureAlertAt = 0;

function safeLabel(value, fallback = "unknown") {
  return String(value || fallback).replace(/[\r\n`]/g, "").slice(0, 120);
}

export function createRequestId() {
  return randomUUID();
}

const LOG_FIELDS = new Set([
  "requestId",
  "commandName",
  "provider",
  "model",
  "status",
  "durationMs",
  "attempt",
  "attempts",
  "fallback",
  "errorType",
  "command",
]);

export function logAiEvent(event, details = {}) {
  const safeDetails = Object.fromEntries(
    Object.entries(details).filter(([key]) => LOG_FIELDS.has(key)),
  );
  console.info(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...safeDetails,
  }));
}

export async function notifyAiFailure({
  client,
  channelId,
  commandName,
  requestId,
  attempts = [],
  now = Date.now(),
}) {
  if (!client || !channelId || now - lastFailureAlertAt < ALERT_COOLDOWN_MS) return false;

  lastFailureAlertAt = now;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return false;

    const providers = attempts.length
      ? attempts.map((attempt) => `${safeLabel(attempt.provider)} (${safeLabel(attempt.model)})`).join(", ")
      : "none configured";
    await channel.send({
      content:
        `[AI alert] All providers failed for ${safeLabel(commandName)}. ` +
        `Providers: ${providers}. Request: ${safeLabel(requestId)}.`,
      allowedMentions: { parse: [] },
    });
    return true;
  } catch {
    return false;
  }
}

export function resetFailureAlertCooldown() {
  lastFailureAlertAt = 0;
}
