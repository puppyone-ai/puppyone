import os from "node:os";
import path from "node:path";
import { localHistorySourceScope } from "../../runtime/history-source-scope.mjs";
import {
  WORKBUDDY_CHINA_CHANNEL,
  WORKBUDDY_INTERNATIONAL_CHANNEL,
  requireWorkBuddyChannel,
} from "./workbuddy-channels.mjs";
import { workBuddyConfigDirectory } from "./workbuddy-config-directory.mjs";

export function workBuddyHistorySource({ channel: channelValue, environment = process.env } = {}) {
  const channel = requireWorkBuddyChannel(channelValue);
  const configRoot = workBuddyConfigDirectory({ channel, environment });
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
