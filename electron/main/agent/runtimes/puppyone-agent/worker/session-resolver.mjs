import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { BUILT_IN_AGENT_DISPLAY_NAME } from "../puppyone-agent-public-identity.mjs";

export async function resolvePuppyOneSession({ cwd, sessionDir, sessionId = null, inMemory = false }) {
  if (!path.isAbsolute(cwd) || !path.isAbsolute(sessionDir)) {
    throw new TypeError(`${BUILT_IN_AGENT_DISPLAY_NAME} session paths must be absolute.`);
  }
  if (inMemory) return SessionManager.inMemory(cwd);
  if (!sessionId) return SessionManager.create(cwd, sessionDir);
  const sessions = await SessionManager.list(cwd, sessionDir);
  const match = sessions.find((session) => session.id === sessionId);
  if (!match) throw new Error(`${BUILT_IN_AGENT_DISPLAY_NAME} session not found: ${sessionId}`);
  return SessionManager.open(match.path, sessionDir, cwd);
}
