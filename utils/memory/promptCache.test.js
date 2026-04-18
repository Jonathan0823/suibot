import { describe, it, expect, beforeEach } from "vitest";
import {
  getCachedPrompt,
  setCachedPrompt,
  invalidatePrompt,
  hasCachedPrompt,
  clearAll,
} from "./promptCache.js";

describe("promptCache", () => {
  beforeEach(() => {
    clearAll();
  });

  it("should return null for uncached prompt", () => {
    expect(getCachedPrompt("test")).toBeNull();
  });

  it("should cache and retrieve prompt", () => {
    setCachedPrompt("test", "You are a helpful assistant");
    expect(getCachedPrompt("test")).toBe("You are a helpful assistant");
  });

  it("should check if prompt is cached", () => {
    expect(hasCachedPrompt("test")).toBe(false);
    setCachedPrompt("test", "Hello");
    expect(hasCachedPrompt("test")).toBe(true);
  });

  it("should invalidate prompt", () => {
    setCachedPrompt("test", "Hello");
    invalidatePrompt("test");
    expect(getCachedPrompt("test")).toBeNull();
  });

  it("should clear all prompts", () => {
    setCachedPrompt("test1", "Hello");
    setCachedPrompt("test2", "World");
    clearAll();
    expect(getCachedPrompt("test1")).toBeNull();
    expect(getCachedPrompt("test2")).toBeNull();
  });
});