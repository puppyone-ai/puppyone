import path from "node:path";
import { localHistorySourceScope } from "../../runtime/history-source-scope.mjs";

export function puppyOneAgentHistorySource(profilePath) {
  const root = path.resolve(profilePath);
  const sessions = path.join(root, "sessions");
  return Object.freeze({
    root,
    sessions,
    sourceScopeId: localHistorySourceScope("puppyone-agent", { root, sessions }, { root: "", sessions: "" }),
  });
}
