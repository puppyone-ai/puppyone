import os from "node:os";
import path from "node:path";
import { historyStoragePath } from "../../runtime/history-source-scope.mjs";
import { requireWorkBuddyChannel } from "./workbuddy-channels.mjs";

/** Resolve the native WorkBuddy profile shared by auth, settings and sessions. */
export function workBuddyConfigDirectory({
  channel: channelValue,
  environment = process.env,
  homedir = os.homedir(),
} = {}) {
  const channel = requireWorkBuddyChannel(channelValue);
  const home = environment.HOME || homedir;
  const configuredRoot = environment[channel.configDirectoryEnvironmentVariable]
    || environment.CODEBUDDY_CONFIG_DIR
    || environment.WORKBUDDY_CONFIG_DIR
    || "";
  return historyStoragePath(configuredRoot, path.join(home, channel.configDirectoryName), home);
}
