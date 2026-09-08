import os from "node:os";
import path from "node:path";
import { localHistorySourceScope, historyStoragePath } from "../../runtime/history-source-scope.mjs";

export function claudeHistorySource(env = process.env) {
  const home = env.HOME || os.homedir();
  const defaultRoot = path.join(os.homedir(), ".claude");
  const root = historyStoragePath(env.CLAUDE_CONFIG_DIR, path.join(home, ".claude"), home);
  return { sourceScopeId: localHistorySourceScope("claude", { root }, { root: defaultRoot }), root };
}
