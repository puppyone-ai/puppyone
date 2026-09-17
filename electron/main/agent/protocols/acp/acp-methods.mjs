export const ACP_PROTOCOL_VERSION = 1;

const METHOD_CANDIDATES = Object.freeze({
  initialize: Object.freeze(["initialize"]),
  authenticate: Object.freeze(["authenticate"]),
  newSession: Object.freeze(["session/new", "newSession"]),
  loadSession: Object.freeze(["session/load", "loadSession"]),
  resumeSession: Object.freeze(["session/resume", "resumeSession"]),
  listSessions: Object.freeze(["session/list", "listSessions"]),
  closeSession: Object.freeze(["session/close", "closeSession"]),
  forkSession: Object.freeze(["session/fork", "forkSession"]),
  deleteSession: Object.freeze(["session/delete", "deleteSession"]),
  prompt: Object.freeze(["session/prompt", "prompt"]),
  cancel: Object.freeze(["session/cancel", "cancel"]),
  setModel: Object.freeze(["session/set_model", "setSessionModel"]),
  setMode: Object.freeze(["session/set_mode", "setSessionMode"]),
  setConfigOption: Object.freeze(["session/set_config_option", "setSessionConfigOption"]),
});

export const ACP_SERVER_NOTIFICATION_ALIASES = Object.freeze({
  sessionUpdate: Object.freeze(["session/update", "sessionUpdate"]),
});

export const ACP_SERVER_REQUEST_ALIASES = Object.freeze({
  requestPermission: Object.freeze(["session/request_permission", "requestPermission"]),
  readTextFile: Object.freeze(["fs/read_text_file", "fs/readTextFile"]),
  writeTextFile: Object.freeze(["fs/write_text_file", "fs/writeTextFile"]),
});

export function acpMethodCandidates(logicalMethod, overrides = {}) {
  const override = overrides?.[logicalMethod];
  if (typeof override === "string" && override) return [override];
  if (Array.isArray(override) && override.length > 0) return override.filter(Boolean);
  const candidates = METHOD_CANDIDATES[logicalMethod];
  if (!candidates) throw new Error(`Unknown ACP logical method: ${logicalMethod}`);
  return [...candidates];
}
