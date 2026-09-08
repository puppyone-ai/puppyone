import os from "node:os";
import path from "node:path";
import { localHistorySourceScope, historyStoragePath } from "../../runtime/history-source-scope.mjs";

export function codexHistorySource(env = process.env) {
  const home = env.HOME || os.homedir();
  const defaultRoot = path.join(os.homedir(), ".codex");
  const root = historyStoragePath(env.CODEX_HOME, path.join(home, ".codex"), home);
  return { sourceScopeId: localHistorySourceScope("codex", { root }, { root: defaultRoot }), root };
}
