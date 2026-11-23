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
