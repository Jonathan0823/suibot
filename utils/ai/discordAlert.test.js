import { afterEach, describe, expect, it, vi } from "vitest";
import { bindAlertClient, sendOperationsAlert } from "./discordAlert.js";

function fakeClient(channel) {
  return {
    channels: {
      fetch: vi.fn().mockResolvedValue(channel),
    },
  };
}

function textChannel() {
  return {
    isTextBased: () => true,
    send: vi.fn().mockResolvedValue({}),
  };
}

afterEach(() => {
  bindAlertClient(null);
  vi.restoreAllMocks();
});

describe("sendOperationsAlert", () => {
  it("logs an unbound failure and does not throw while unbound", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(sendOperationsAlert("channel-1", "alert text")).resolves.toBeUndefined();

    expect(info).toHaveBeenCalledWith(expect.stringContaining('"errorType":"unbound"'));
  });

  it("sends the text to a text channel with mentions disabled", async () => {
    const channel = textChannel();
    const client = fakeClient(channel);
    bindAlertClient(client);

    await sendOperationsAlert("channel-1", "alert text");

    expect(client.channels.fetch).toHaveBeenCalledWith("channel-1");
    expect(channel.send).toHaveBeenCalledWith({
      content: "alert text",
      allowedMentions: { parse: [] },
    });
  });

  it("logs and skips a channel that is not text based", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const channel = { isTextBased: () => false, send: vi.fn() };
    bindAlertClient(fakeClient(channel));

    await expect(sendOperationsAlert("channel-1", "alert text")).resolves.toBeUndefined();

    expect(channel.send).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining("ai_alert_failed"));
  });

  it("logs and swallows a missing channel", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    bindAlertClient(fakeClient(null));

    await expect(sendOperationsAlert("channel-1", "alert text")).resolves.toBeUndefined();

    expect(info).toHaveBeenCalledWith(expect.stringContaining("ai_alert_failed"));
  });

  it("logs and swallows a Discord send error", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const channel = textChannel();
    channel.send.mockRejectedValue(new Error("discord down"));
    bindAlertClient(fakeClient(channel));

    await expect(sendOperationsAlert("channel-1", "alert text")).resolves.toBeUndefined();

    expect(info).toHaveBeenCalledWith(expect.stringContaining("discord down"));
  });
});
