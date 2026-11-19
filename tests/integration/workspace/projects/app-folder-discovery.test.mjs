import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppFolderDiscovery } from "../../../../electron/main/project-import/app-folders.mjs";

let home;
beforeEach(async () => { home = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-app-folders-")); });
afterEach(async () => { await fs.rm(home, { recursive: true, force: true }); });

describe("recorded app folder discovery", () => {
  it("lists existing Obsidian vaults in place without changing their files", async () => {
    const vault = path.join(home, "Notes");
    await fs.mkdir(vault);
    await fs.writeFile(path.join(vault, "note.md"), "original");
    const config = path.join(home, "Library", "Application Support", "obsidian");
    await fs.mkdir(config, { recursive: true });
    await fs.writeFile(path.join(config, "obsidian.json"), JSON.stringify({ vaults: {
      notes: { path: vault, ts: 2 }, missing: { path: path.join(home, "Missing"), ts: 3 }, invalid: null,
    } }));
    const discovery = createAppFolderDiscovery({ home, platform: "darwin" });
    await expect(discovery.list("obsidian")).resolves.toEqual([{ path: vault, name: "Notes", lastUsedAt: 2 }]);
    expect(await fs.readFile(path.join(vault, "note.md"), "utf8")).toBe("original");
    expect(await fs.readdir(vault)).toEqual(["note.md"]);
  });

  it("skips a malformed URI without hiding valid local folders", async () => {
    const vault = path.join(home, "Notes");
    await fs.mkdir(vault);
    const readSqliteValue = vi.fn(async () => JSON.stringify({ entries: [
      { folderUri: "file:///broken%ZZ" },
      { folderUri: "file:///broken%00" },
      { folderUri: pathToFileURL(vault).href },
      { folderUri: pathToFileURL(vault).href },
      { folderUri: "vscode-remote://host/remote" },
      { folderUri: pathToFileURL(vault).href, remoteAuthority: "ssh-remote+host" },
      { fileUri: pathToFileURL(vault).href },
    ] }));
    const discovery = createAppFolderDiscovery({ home, platform: "darwin", readSqliteValue });
    await expect(discovery.list("vscode")).resolves.toEqual([{ path: vault, name: "Notes", lastUsedAt: null }]);
    expect(readSqliteValue).toHaveBeenCalledWith(
      path.join(home, "Library", "Application Support", "Code", "User", "globalStorage", "state.vscdb"),
      "history.recentlyOpenedPathsList",
    );
  });

  it("treats an absent app record as empty, and reports unreadable or corrupt records", async () => {
    await expect(createAppFolderDiscovery({ home, platform: "darwin" }).list("vscode")).resolves.toEqual([]);
    await expect(createAppFolderDiscovery({ home, platform: "darwin" }).list("obsidian")).resolves.toEqual([]);
    const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const discovery = createAppFolderDiscovery({ home, readSqliteValue: async () => { throw denied; } });
    await expect(discovery.list("cursor")).rejects.toBe(denied);
    const corrupt = createAppFolderDiscovery({ home, readSqliteValue: async () => "invalid JSON" });
    await expect(corrupt.list("vscode")).rejects.toBeInstanceOf(SyntaxError);
  });

  it.each([
    ["linux", { XDG_CONFIG_HOME: "/custom-config" }, "/custom-config"],
    ["win32", { APPDATA: "/roaming" }, "/roaming"],
  ])("uses the configured app data folder on %s", async (platform, env, configRoot) => {
    const readSqliteValue = vi.fn(async () => null);
    await createAppFolderDiscovery({ home, platform, env, readSqliteValue }).list("cursor");
    expect(readSqliteValue).toHaveBeenCalledWith(path.join(configRoot, "Cursor", "User", "globalStorage", "state.vscdb"), expect.any(String));
  });

  it("only offers Typora preferences on macOS and rejects unknown sources", async () => {
    const readPlistValue = vi.fn(async () => []);
    await expect(createAppFolderDiscovery({ home, platform: "linux", readPlistValue }).list("typora")).resolves.toEqual([]);
    expect(readPlistValue).not.toHaveBeenCalled();
    const discovery = createAppFolderDiscovery({ home, platform: "darwin", readPlistValue });
    await expect(discovery.list("typora")).resolves.toEqual([]);
    expect(readPlistValue).toHaveBeenCalledWith(path.join(home, "Library", "Preferences", "abnerworks.Typora.plist"), "recentFolder");
    await expect(discovery.list("unknown")).rejects.toThrow(/known folder source/);
  });
});
