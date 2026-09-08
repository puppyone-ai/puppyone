import os from "node:os";
import { localHistorySourceScope } from "../../runtime/history-source-scope.mjs";

export function cursorHistorySource(env = process.env) {
  return localHistorySourceScope("cursor", { home: env.HOME || os.homedir(), config: env.XDG_CONFIG_HOME || "", data: env.XDG_DATA_HOME || "" },
    { home: os.homedir(), config: "", data: "" });
}
