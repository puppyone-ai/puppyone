import os from "node:os";
import path from "node:path";
import { historyStoragePath, localHistorySourceScope } from "../../runtime/history-source-scope.mjs";
import {
  WORKBUDDY_CHINA_CHANNEL,
  WORKBUDDY_INTERNATIONAL_CHANNEL,
  requireWorkBuddyChannel,
} from "./workbuddy-channels.mjs";

export function workBuddyHistorySource({ channel: channelValue, environment = process.env } = {}) {
  const channel = requireWorkBuddyChannel(channelValue);
  const home = environment.HOME || os.homedir();
  const configuredRoot = environment[channel.configDirectoryEnvironmentVariable]
    || environment.CODEBUDDY_CONFIG_DIR
    || environment.WORKBUDDY_CONFIG_DIR
    || "";
  const defaultRoot = path.join(home, channel.configDirectoryName);
  const configRoot = historyStoragePath(configuredRoot, defaultRoot, home);
  // Keep the original namespace/selectors so existing single-registration
  // WorkBuddy sessions retain their exact native history identity.
  return localHistorySourceScope("workbuddy", { channel: channel.channel, configRoot }, {
    channel: "codebuddy-cli",
    configRoot: path.join(os.homedir(), ".codebuddy"),
  });
}

export function legacyWorkBuddyRuntimeIdForSourceScope(sourceScopeId, environment = process.env) {
  if (!sourceScopeId) return null;
  for (const channel of [WORKBUDDY_CHINA_CHANNEL, WORKBUDDY_INTERNATIONAL_CHANNEL]) {
    if (workBuddyHistorySource({ channel, environment }) === sourceScopeId) return channel.id;
  }
  return null;
}
