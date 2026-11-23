import { randomUUID } from "node:crypto";

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
  "errorName",
  "errorMessage",
  "statusCode",
  "command",
]);

function sanitizeErrorMessage(value) {
  return String(value || "Unknown error")
    .replace(/\b(?:sk|sk-or-v1)-[\w-]+/gi, "[redacted-api-key]")
    .replace(/(authorization|api[-_ ]?key|token|secret|password)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 500);
}

export function logAiEvent(event, details = {}) {
  const safeDetails = Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => LOG_FIELDS.has(key))
      .map(([key, value]) => [key, key === "errorMessage" ? sanitizeErrorMessage(value) : value]),
  );
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...safeDetails,
    }),
  );
}
