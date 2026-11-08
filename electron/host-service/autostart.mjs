/**
 * Start the PuppyOne Host service when the person logs in, so shared folders
 * come back after a restart without opening the App. Off unless the person
 * turns it on; turning it off only removes the login entry (a running host
 * service keeps sharing until stopped from the App).
 *
 * - macOS: a per-user LaunchAgent (launchd) that runs the App with --puppyone-host.
 * - Linux: an XDG autostart entry for the desktop session.
 * - Windows: the App's login item with --puppyone-host.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hostServiceCommand } from "./launcher.mjs";

export const LAUNCH_AGENT_LABEL = "ai.puppyone.host";
const XDG_ENTRY = "puppyone-host.desktop";

const xml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Desktop Entry Exec quoting: every argument in double quotes, with ", `, $ and \ escaped.
const desktopArgument = (value) => `"${String(value).replace(/(["`$\\])/g, "\\$1")}"`;

export function launchAgentPlist({ command, args }) {
  const program = [command, ...args].map((item) => `    <string>${xml(item)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${program}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
</dict>
</plist>
`;
}

export function xdgAutostartEntry({ command, args }) {
  return `[Desktop Entry]
Type=Application
Name=PuppyOne Host
Comment=Shares the folders you chose with your other computers
Exec=${[command, ...args].map(desktopArgument).join(" ")}
NoDisplay=true
X-GNOME-Autostart-enabled=true
`;
}

export function createHostAutostart({ platform = process.platform, home = os.homedir(), execPath, appPath, isPackaged,
  app = null, fsImpl = fs }) {
  // A checkout is temporary and its profile may be supplied only by the dev
  // launcher. Never replace an installed app's persistent OS login entry.
  if (!isPackaged) return Object.freeze({
    supported: false,
    async status() { return { supported: false, enabled: false }; },
    async set() { return false; },
  });
  const command = hostServiceCommand({ execPath, appPath, isPackaged });
  const entries = {
    darwin: () => ({ file: path.join(home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`), contents: launchAgentPlist(command) }),
    linux: () => ({ file: path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "autostart", XDG_ENTRY),
      contents: xdgAutostartEntry(command) }),
  };
  const { file: entryPath = null, contents = null } = entries[platform]?.() ?? {};

  async function enabled() {
    if (platform === "win32") {
      return app?.getLoginItemSettings({ path: command.command, args: command.args })?.openAtLogin === true;
    }
    if (!entryPath) return false;
    try { return (await fsImpl.readFile(entryPath, "utf8")) === contents; } catch { return false; }
  }

  return Object.freeze({
    supported: platform === "darwin" || platform === "linux" || (platform === "win32" && Boolean(app)),
    async status() { return { supported: this.supported, enabled: await enabled() }; },
    async set(on) {
      if (platform === "win32") {
        app?.setLoginItemSettings({ openAtLogin: on === true, path: command.command, args: command.args });
        return enabled();
      }
      if (!entryPath) return false;
      if (on === true) {
        await fsImpl.mkdir(path.dirname(entryPath), { recursive: true });
        await fsImpl.writeFile(entryPath, contents, { mode: 0o644 });
      } else {
        await fsImpl.rm(entryPath, { force: true });
      }
      return enabled();
    },
  });
}
