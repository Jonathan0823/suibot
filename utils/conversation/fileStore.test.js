import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFileStore } from "./fileStore.js";

const record = (overrides = {}) => ({
  recent: [{ sender: "Alice", content: "hi" }],
  summary: "",
  lastActive: 1_000,
  ...overrides,
});

let dir;
let file;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "conversation-store-"));
  file = path.join(dir, "memory.json");
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

const readFile = () => JSON.parse(fs.readFileSync(file, "utf-8"));

describe("file conversation store", () => {
  it("round-trips a record across a new store instance", () => {
    createFileStore({ storagePath: file }).put("g:c:u:hutao", record());

    const reopened = createFileStore({ storagePath: file });
    expect(reopened.get("g:c:u:hutao")).toEqual(record());
    expect(reopened.keys()).toEqual(["g:c:u:hutao"]);
  });

  it("returns null for unknown keys and forgets deleted records across restarts", () => {
    const store = createFileStore({ storagePath: file });
    store.put("k", record());
    store.delete("k");

    expect(store.get("k")).toBeNull();
    expect(store.get("constructor")).toBeNull();
    expect(createFileStore({ storagePath: file }).keys()).toEqual([]);
  });

  it("loads the legacy shape: lastSaved becomes lastActive, object summary becomes its text, fact entries are dropped", () => {
    const legacyRecent = [
      { sender: "Alice", content: "hi" },
      { sender: "hutao", content: "boo" },
    ];
    fs.writeFileSync(
      file,
      JSON.stringify({
        "g:c:u:hutao": {
          recent: legacyRecent,
          summary: { turns: [], summary: "[Previous 10 exchanges]" },
          lastSaved: 5_000,
        },
        "g:c:u:hutao:fact:name": "Alice",
      }),
    );

    const store = createFileStore({ storagePath: file });
    expect(store.keys()).toEqual(["g:c:u:hutao"]);
    expect(store.get("g:c:u:hutao")).toEqual({
      recent: legacyRecent,
      summary: "[Previous 10 exchanges]",
      lastActive: 5_000,
    });
    expect(store.get("g:c:u:hutao:fact:name")).toBeNull();
  });

  it("removes leftover fact entries from the file after the next write", () => {
    fs.writeFileSync(
      file,
      JSON.stringify({
        k: { recent: [], summary: { turns: [], summary: "" }, lastSaved: 1 },
        "k:fact:name": "Alice",
      }),
    );

    createFileStore({ storagePath: file }).put("other", record());

    const saved = readFile();
    expect(Object.keys(saved).sort()).toEqual(["k", "other"]);
  });

  it("starts empty when the file is missing and creates it on the first write", () => {
    const store = createFileStore({ storagePath: file });
    expect(store.keys()).toEqual([]);
    expect(fs.existsSync(file)).toBe(false);

    store.put("k", record());
    expect(readFile()).toEqual({ k: record() });
  });

  it("starts empty and logs an error when the file is corrupt, without throwing", () => {
    fs.writeFileSync(file, "{not json");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const store = createFileStore({ storagePath: file });
    expect(store.get("k")).toBeNull();
    expect(store.keys()).toEqual([]);
    expect(error).toHaveBeenCalled();

    store.put("k", record());
    expect(readFile()).toEqual({ k: record() });
  });

  it("reads the file lazily and at most once, serving later reads from memory", () => {
    fs.writeFileSync(file, JSON.stringify({ k: record() }));
    const read = vi.spyOn(fs, "readFileSync");

    const store = createFileStore({ storagePath: file });
    expect(read).not.toHaveBeenCalled();

    expect(store.get("k")).toEqual(record());
    expect(store.get("k")).toEqual(record());
    expect(store.keys()).toEqual(["k"]);
    expect(read.mock.calls.filter(([p]) => p === file)).toHaveLength(1);
  });

  it("writes the file exactly once per put or delete", () => {
    const store = createFileStore({ storagePath: file });
    const write = vi.spyOn(fs, "writeFileSync");

    store.put("a", record());
    store.put("b", record());
    store.delete("a");
    store.get("b");
    store.keys();

    expect(write).toHaveBeenCalledTimes(3);
  });

  it("keeps a legacy record with no timestamp without a last-active time", () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ k: { recent: [{ sender: "Alice", content: "hi" }], summary: "" } }),
    );

    const loaded = createFileStore({ storagePath: file }).get("k");
    expect(loaded.recent).toEqual([{ sender: "Alice", content: "hi" }]);
    expect(loaded.lastActive).toBeUndefined();
  });

});
