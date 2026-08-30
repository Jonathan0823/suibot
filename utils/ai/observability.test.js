import { afterEach, describe, expect, it, vi } from "vitest";
import { logAiEvent, notifyAiFailure, resetFailureAlertCooldown } from "./observability.js";

afterEach(() => {
  resetFailureAlertCooldown();
  vi.restoreAllMocks();
});

describe("AI observability", () => {
  it("logs only approved metadata fields", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logAiEvent("ai_request", {
      provider: "openrouter",
      model: "test-model",
      status: "success",
      errorName: "Error",
      errorMessage: "provider api-key=sk-or-v1-secret",
      statusCode: 500,
      prompt: "must not be logged",
      apiKey: "secret",
    });

    const output = JSON.parse(info.mock.calls[0][0]);
    expect(output.provider).toBe("openrouter");
    expect(output.model).toBe("test-model");
    expect(output.errorName).toBe("Error");
    expect(output.errorMessage).not.toContain("sk-or-v1-secret");
    expect(output.statusCode).toBe(500);
    expect(output.prompt).toBeUndefined();
    expect(output.apiKey).toBeUndefined();
  });

  it("sends sanitized all-provider failure alerts with mentions disabled", async () => {
    const send = vi.fn();
    const client = {
      channels: { fetch: vi.fn().mockResolvedValue({ isTextBased: () => true, send }) },
    };

    await notifyAiFailure({
      client,
      channelId: "channel-1",
      commandName: "yukinon",
      requestId: "request-1",
      attempts: [{ provider: "first", model: "model-1" }],
    });

    expect(send).toHaveBeenCalledWith({
      content: expect.stringContaining("first (model-1)"),
      allowedMentions: { parse: [] },
    });
  });
});
