import { afterEach, describe, expect, it } from "vitest";
import { isAuthorized } from "./aiProvider.js";

afterEach(() => {
  delete process.env.AI_ADMIN_USER_IDS;
});

describe("AI provider admin authorization", () => {
  it("authorizes configured Discord user IDs only", () => {
    process.env.AI_ADMIN_USER_IDS = "111, 222";

    expect(isAuthorized({ user: { id: "222" } })).toBe(true);
    expect(isAuthorized({ user: { id: "333" } })).toBe(false);
  });

  it("denies everyone when no admin IDs are configured", () => {
    expect(isAuthorized({ user: { id: "111" } })).toBe(false);
  });
});
