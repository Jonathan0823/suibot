import { afterEach, describe, expect, it, vi } from "vitest";
import { logAiEvent } from "./observability.js";

afterEach(() => {
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

  it("keeps the ai_compaction fields", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    logAiEvent("ai_compaction", {
      turnsFolded: 10,
      tokensBefore: 1700,
      tokensAfter: 700,
      outcome: "summarized",
      errorType: "Error",
    });
    const output = JSON.parse(info.mock.calls[0][0]);
    expect(output).toMatchObject({
      turnsFolded: 10,
      tokensBefore: 1700,
      tokensAfter: 700,
      outcome: "summarized",
      errorType: "Error",
    });
  });
});

describe("AI observability: Tool errors", () => {
  it("logs a Tool's error message with keys and tokens redacted", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      logAiEvent("ai_tool_use", {
        tool: "web_search",
        ok: false,
        errorMessage: "Request failed: api_key=AIzaSECRET token: abc123 sk-or-v1-deadbeef",
        errorType: "Error",
      });
      const line = JSON.parse(info.mock.calls[0][0]);
      expect(line).toMatchObject({
        event: "ai_tool_use",
        tool: "web_search",
        ok: false,
        errorType: "Error",
      });
      expect(line.errorMessage).toContain("Request failed");
      expect(line.errorMessage).not.toMatch(/AIzaSECRET|abc123|deadbeef/);
    } finally {
      info.mockRestore();
    }
  });
});
