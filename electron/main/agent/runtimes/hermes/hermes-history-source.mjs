import os from "node:os";
import path from "node:path";
import {
  historyStoragePath,
  localHistorySourceScope,
} from "../../runtime/history-source-scope.mjs";

/** Scope persisted ACP sessions to the Hermes home that owns state.db. */
export function hermesHistorySource(environment = process.env) {
  const home = environment.HOME || environment.USERPROFILE || os.homedir();
  const root = historyStoragePath(environment.HERMES_HOME, path.join(home, ".hermes"), home);
  return localHistorySourceScope("hermes", { root }, {
    root: path.join(os.homedir(), ".hermes"),
  });
}
