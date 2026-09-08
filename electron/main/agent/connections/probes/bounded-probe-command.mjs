import { runBoundedProcessProbe } from "../../transports/bounded-process-probe.mjs";

export const LOCAL_AGENT_PROBE_TIMEOUT_MS = 1_500;
export const LOCAL_AGENT_PROBE_MAX_OUTPUT_BYTES = 16 * 1024;

const ENVIRONMENT_ALLOWLIST = Object.freeze([
  "HOME", "USER", "LOGNAME", "PATH", "TMPDIR", "TMP", "TEMP",
  "LANG", "LC_ALL", "LC_CTYPE", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
  "XDG_STATE_HOME", "XDG_CACHE_HOME", "SystemRoot", "ComSpec", "PATHEXT",
]);

export function createProbeEnvironment(baseEnv = process.env) {
  const environment = {};
  for (const key of ENVIRONMENT_ALLOWLIST) {
    const value = baseEnv?.[key];
    if (typeof value === "string" && value.length <= 8_192 && !value.includes("\0")) environment[key] = value;
  }
  return {
    ...environment,
    TERM: "dumb",
    NO_COLOR: "1",
    PUPPYONE_AGENT_PROBE: "1",
  };
}

export function runBoundedProbeCommand(executablePath, args, options = {}) {
  return runBoundedProcessProbe(executablePath, args, { env: createProbeEnvironment(), ...options });
}
