import os from "node:os";
import path from "node:path";
import { localHistorySourceScope, historyStoragePath } from "../../runtime/history-source-scope.mjs";

export function openCodeHistorySource(env = process.env) {
  const home = env.HOME || os.homedir();
  const data = historyStoragePath(env.XDG_DATA_HOME, path.join(home, ".local/share"), home);
  const defaults = { data: path.join(os.homedir(), ".local/share"), database: "", profile: "", testHome: "" };
  return localHistorySourceScope("opencode", { data,
    database: env.OPENCODE_DB || "", profile: env.OPENCODE_CONFIG_DIR || "", testHome: env.OPENCODE_TEST_HOME || "" }, defaults);
}
