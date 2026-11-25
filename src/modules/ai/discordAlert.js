import { logAiEvent } from "./observability.js";

let alertClient = null;

export function bindAlertClient(client) {
  alertClient = client;
}

export async function sendOperationsAlert(channelId, text) {
  if (!alertClient) {
    logAiEvent("ai_alert_failed", { errorType: "unbound" });
    return;
  }

  try {
    const channel = await alertClient.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      logAiEvent("ai_alert_failed", { errorType: "channel" });
      return;
    }
    await channel.send({ content: text, allowedMentions: { parse: [] } });
  } catch (error) {
    logAiEvent("ai_alert_failed", {
      errorType: "discord",
      errorName: error?.name || "Error",
      errorMessage: error?.message,
    });
  }
}
