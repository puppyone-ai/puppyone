import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHostAutostart, LAUNCH_AGENT_LABEL } from "../../../../electron/host-service/autostart.mjs";

describe("host service at login", () => {
  let home;
  beforeEach(async () => { home = await fs.mkdtemp(path.join(os.tmpdir(), "host-autostart-")); });
  afterEach(async () => { await fs.rm(home, { recursive: true, force: true }); });

  it("macOS: a per-user LaunchAgent that starts only the host service, removed when turned off", async () => {
    const autostart = createHostAutostart({ platform: "darwin", home, execPath: "/Applications/PuppyOne.app/Contents/MacOS/PuppyOne",
      appPath: "/unused", isPackaged: true });
    expect(await autostart.status()).toEqual({ supported: true, enabled: false });
    expect(await autostart.set(true)).toBe(true);
    const plist = await fs.readFile(path.join(home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`), "utf8");
    expect(plist).toContain("<string>/Applications/PuppyOne.app/Contents/MacOS/PuppyOne</string>");
    expect(plist).toContain("<string>--puppyone-host</string>");
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(await autostart.set(false)).toBe(false);
    await expect(fs.access(path.join(home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`))).rejects.toThrow();
  });

  it("Linux: an XDG autostart entry with every argument quoted; development builds pass the App path", async () => {
    const previous = process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_CONFIG_HOME;
    try {
      const autostart = createHostAutostart({ platform: "linux", home, execPath: "/opt/Puppy One/electron",
        appPath: "/src/app $x", isPackaged: false });
      expect(await autostart.set(true)).toBe(true);
      const entry = await fs.readFile(path.join(home, ".config", "autostart", "puppyone-host.desktop"), "utf8");
      expect(entry).toContain('Exec="/opt/Puppy One/electron" "/src/app \\$x" "--puppyone-host"');
      expect((await autostart.status()).enabled).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
    }
  });

  it("Windows: the App's login item with the host argument", async () => {
    let settings = { openAtLogin: false };
    const app = { setLoginItemSettings: (value) => { settings = value; },
      getLoginItemSettings: ({ args }) => ({ openAtLogin: settings.openAtLogin && args.includes("--puppyone-host") }) };
    const autostart = createHostAutostart({ platform: "win32", home, execPath: "C:\\PuppyOne\\PuppyOne.exe", appPath: "x",
      isPackaged: true, app });
    expect(await autostart.set(true)).toBe(true);
    expect(settings).toEqual({ openAtLogin: true, path: "C:\\PuppyOne\\PuppyOne.exe", args: ["--puppyone-host"] });
  });
});
