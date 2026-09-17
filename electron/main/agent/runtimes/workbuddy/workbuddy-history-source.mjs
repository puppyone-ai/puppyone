import os from "node:os";
import path from "node:path";
import { historyStoragePath, localHistorySourceScope } from "../../runtime/history-source-scope.mjs";

export function workBuddyHistorySource({ executablePath = "", environment = process.env } = {}) {
  const home = environment.HOME || os.homedir();
  const channel = workBuddyChannel({ executablePath, environment });
  const configuredRoot = environment.CODEBUDDY_CONFIG_DIR || environment.WORKBUDDY_CONFIG_DIR || "";
  const defaultRoot = path.join(home, channel === "international-app"
    ? ".workbuddy-ai"
    : channel === "china-app"
      ? ".workbuddy"
      : ".codebuddy");
  const configRoot = historyStoragePath(configuredRoot, defaultRoot, home);
  return localHistorySourceScope("workbuddy", { channel, configRoot }, {
    channel: "codebuddy-cli",
    configRoot: path.join(os.homedir(), ".codebuddy"),
  });
}

export function workBuddyChannel({ executablePath = "", environment = process.env } = {}) {
  const route = String(environment.CODEBUDDY_INTERNET_ENVIRONMENT || "").trim().toLowerCase();
  if (route === "internal") return "china";
  if (route === "ioa") return "ioa";
  if (route === "cloudhosted" || route === "selfhosted") return "selfhosted";
  if (route === "public") return "international";

  const normalizedPath = String(executablePath).replaceAll("\\", "/").toLowerCase();
  if (normalizedPath.includes("/workbuddy ai.app/")) return "international-app";
  if (normalizedPath.includes("/workbuddy.app/")) return "china-app";
  return "codebuddy-cli";
}
