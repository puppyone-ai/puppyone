import os from "node:os";
import path from "node:path";
import { localHistorySourceScope, historyStoragePath } from "../../runtime/history-source-scope.mjs";

export function piHistorySource(env = process.env) {
  const home = env.HOME || os.homedir();
  const defaultRoot = path.join(os.homedir(), ".pi/agent");
  const root = historyStoragePath(env.PI_CODING_AGENT_DIR, path.join(home, ".pi/agent"), home);
  const defaultSessions = path.join(defaultRoot, "sessions");
  const sessions = historyStoragePath(env.PI_CODING_AGENT_SESSION_DIR, path.join(root, "sessions"), home);
  return { sourceScopeId: localHistorySourceScope("pi", { root, sessions }, { root: defaultRoot, sessions: defaultSessions }), root };
}
