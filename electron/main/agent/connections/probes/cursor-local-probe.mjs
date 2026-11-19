import { assertExecutableIdentity } from "./executable-candidates.mjs";
import { createProbeEnvironment, runBoundedProbeCommand } from "./bounded-probe-command.mjs";

// Cursor's cold CLI bootstrap and account lookup exceed the generic local probe
// budget. Keep both commands bounded without changing other providers' budgets.
const CURSOR_VERSION_PROBE_TIMEOUT_MS = 5_000;
const CURSOR_STATUS_PROBE_TIMEOUT_MS = 10_000;

export function parseCursorLocalVersion(value) {
  return String(value).match(/\b(\d{4}\.\d{2}\.\d{2}(?:-[A-Za-z0-9._-]+)?|\d+\.\d+\.\d+)\b/)?.[1] ?? null;
}

export function parseCursorAuthentication(value) {
  const status = String(value || "").toLowerCase();
  if (/expired|session has expired|credentials? expired/.test(status)) return "expired";
  if (/not authenticated|not logged[ -]?in|signed[ -]?out|login required|please (?:log|sign)[ -]?in/.test(status)) return "signed-out";
  if (/authenticated|logged[ -]?in|signed[ -]?in/.test(status)) return "signed-in";
  if (/\berror\b|failed|secitemcopymatching|unable to/.test(status)) return "error";
  return "unknown";
}

export async function probeCursorLocal({
  candidate,
  runCommand = runBoundedProbeCommand,
  env = process.env,
  signal,
} = {}) {
  if (!candidate) return missingCursor();
  try {
    const executablePath = runCommand === runBoundedProbeCommand
      ? await assertExecutableIdentity(candidate)
      : candidate.executablePath;
    const probeEnvironment = createProbeEnvironment(env);
    const versionResult = await runCommand(
      executablePath,
      [...(candidate.argsPrefix || []), "--version"],
      { env: probeEnvironment, signal, timeoutMs: CURSOR_VERSION_PROBE_TIMEOUT_MS, label: "Cursor version probe" },
    );
    const version = parseCursorLocalVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
    if (versionResult.code !== 0 || !version) {
      return brokenCursor(candidate.source, probeFailureDiagnostic("version", versionResult));
    }
    let authentication = "unknown";
    let authenticationDiagnostic = null;
    let authenticationExitCode = null;
    let authenticationSignal = null;
    let authenticationFailure = null;
    try {
      const statusExecutablePath = runCommand === runBoundedProbeCommand
        ? await assertExecutableIdentity(candidate)
        : executablePath;
      const statusResult = await runCommand(
        statusExecutablePath,
        [...(candidate.argsPrefix || []), "status"],
        { env: probeEnvironment, signal, timeoutMs: CURSOR_STATUS_PROBE_TIMEOUT_MS, label: "Cursor status probe" },
      );
      const statusOutput = `${statusResult.stdout}\n${statusResult.stderr}`;
      authentication = parseCursorAuthentication(statusOutput);
      authenticationExitCode = Number.isInteger(statusResult.code) ? statusResult.code : null;
      authenticationSignal = statusResult.signal ? String(statusResult.signal) : null;
      if (statusResult.code !== 0 && !["signed-out", "expired"].includes(authentication)) {
        authentication = "error";
      }
      if (["error", "unknown"].includes(authentication)) {
        authenticationDiagnostic = probeFailureDiagnostic("status", statusResult);
      }
      if (authentication === "error") {
        authenticationFailure = statusResult.signal || (Number.isInteger(statusResult.code) && statusResult.code >= 128)
          ? "crashed"
          : "failed";
      }
    } catch (error) {
      authentication = "error";
      authenticationDiagnostic = error instanceof Error ? error.message : String(error);
      authenticationFailure = /timed out/i.test(authenticationDiagnostic) ? "timed-out" : "failed";
    }
    return {
      ...baseCursor(candidate.source),
      installation: "detected",
      version,
      authentication,
      ...(authenticationDiagnostic ? { authenticationDiagnostic } : {}),
      ...(authenticationExitCode !== null ? { authenticationExitCode } : {}),
      ...(authenticationSignal ? { authenticationSignal } : {}),
      ...(authenticationFailure ? { authenticationFailure } : {}),
    };
  } catch (error) {
    return brokenCursor(candidate.source, error instanceof Error ? error.message : String(error));
  }
}

function baseCursor(source) {
  return {
    id: "cursor-agent",
    displayName: "Cursor Agent",
    authentication: "unknown",
    protocolCompatible: true,
    hasModels: false,
    source: normalizeSource(source),
  };
}

function missingCursor() {
  return { ...baseCursor(null), installation: "not-found", version: null };
}

function brokenCursor(source, diagnostic = null) {
  return {
    ...baseCursor(source),
    installation: "broken",
    version: null,
    authentication: "error",
    ...(diagnostic ? { diagnostic: String(diagnostic).trim().slice(0, 4_000) } : {}),
  };
}

function probeFailureDiagnostic(probe, result) {
  const termination = result?.signal
    ? `signal ${String(result.signal)}`
    : Number.isInteger(result?.code) ? `exit code ${result.code}` : "an unknown exit status";
  const output = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`.trim().slice(0, 3_500);
  return `Cursor ${probe} probe ended with ${termination}.${output ? ` ${output}` : ""}`;
}

function normalizeSource(source) {
  return ["configured", "user-installation", "system-installation", "path-installation", "application-bundle"].includes(source)
    ? source
    : null;
}
