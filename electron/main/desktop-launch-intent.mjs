import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP_LAUNCH_INTENT_VERSION = 2;

export function createDesktopLaunchIntent({
  argv = process.argv,
  workingDirectory = process.cwd(),
  isPackaged = false,
  statSync = fs.statSync,
} = {}) {
  const launchArguments = Array.isArray(argv)
    ? argv.slice(isPackaged ? 1 : 2)
    : [];

  return {
    version: DESKTOP_LAUNCH_INTENT_VERSION,
    ...findLaunchTargetArg(launchArguments, { workingDirectory, statSync }),
  };
}

export function parseDesktopLaunchIntent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.version !== DESKTOP_LAUNCH_INTENT_VERSION) return null;

  const workspacePath = parseLaunchPath(value.workspacePath);
  const filePath = parseLaunchPath(value.filePath);
  if (workspacePath === undefined || filePath === undefined) return null;
  return { version: DESKTOP_LAUNCH_INTENT_VERSION, workspacePath, filePath };
}

function parseLaunchPath(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.trim().length === 0 || !path.isAbsolute(value)) return undefined;
  return path.normalize(value);
}

/** The last folder or file named on the command line. */
export function findLaunchTargetArg(argv, {
  workingDirectory = process.cwd(),
  statSync = fs.statSync,
} = {}) {
  const args = Array.isArray(argv) ? argv : [];
  const basePath = resolveWorkingDirectory(workingDirectory);

  for (const rawArgument of [...args].reverse()) {
    if (typeof rawArgument !== "string") continue;
    const argument = rawArgument.trim();
    if (!argument || argument.startsWith("-")) continue;

    try {
      const candidate = path.resolve(basePath, localPathFromArgument(argument));
      const target = statSync(candidate);
      if (target.isDirectory()) return { workspacePath: candidate, filePath: null };
      if (target.isFile()) return { workspacePath: null, filePath: candidate };
    } catch {
      // Command-line input is untrusted. Non-path arguments are ignored.
    }
  }

  return { workspacePath: null, filePath: null };
}

export function findWorkspacePathArg(argv, options) {
  return findLaunchTargetArg(argv, options).workspacePath;
}

/** Linux file managers hand over file:// URIs. Other schemes are not paths. */
function localPathFromArgument(argument) {
  return argument.startsWith("file://") ? fileURLToPath(argument) : argument;
}

export async function handleSecondInstanceLaunch({
  launchIntent,
  argv,
  workingDirectory,
  isPackaged = false,
  statSync = fs.statSync,
  openFile,
  openWorkspaceInNewWindow,
  revealOrCreateWindow,
  reportError = console.error,
} = {}) {
  const intent = parseDesktopLaunchIntent(launchIntent)
    ?? createDesktopLaunchIntent({
      argv,
      workingDirectory,
      isPackaged,
      statSync,
    });

  if (intent.filePath && typeof openFile === "function") {
    try {
      if (await openFile(intent.filePath)) return { status: "opened-file", filePath: intent.filePath };
    } catch (error) {
      reportSafely(reportError, "Unable to open the file requested by a second puppyone instance:", error);
    }
    return revealSafely({ revealOrCreateWindow, reportError, successStatus: "recovered-window" });
  }

  if (!intent.workspacePath) {
    return revealSafely({
      revealOrCreateWindow,
      reportError,
      successStatus: "revealed-window",
    });
  }

  try {
    await openWorkspaceInNewWindow(intent.workspacePath);
    return {
      status: "opened-workspace",
      workspacePath: intent.workspacePath,
    };
  } catch (error) {
    reportSafely(
      reportError,
      "Unable to open the workspace requested by a second puppyone instance:",
      error,
    );
    return revealSafely({
      revealOrCreateWindow,
      reportError,
      successStatus: "recovered-window",
      workspacePath: intent.workspacePath,
    });
  }
}

function resolveWorkingDirectory(value) {
  if (typeof value !== "string" || value.trim().length === 0) return process.cwd();
  try {
    return path.resolve(value);
  } catch {
    return process.cwd();
  }
}

async function revealSafely({
  revealOrCreateWindow,
  reportError,
  successStatus,
  workspacePath = null,
}) {
  try {
    await revealOrCreateWindow();
    return {
      status: successStatus,
      workspacePath,
    };
  } catch (error) {
    reportSafely(
      reportError,
      "Unable to reveal puppyone after a second-instance launch:",
      error,
    );
    return {
      status: "ignored-error",
      workspacePath,
    };
  }
}

function reportSafely(reportError, message, error) {
  if (typeof reportError !== "function") return;
  try {
    reportError(message, error);
  } catch {
    // A diagnostic sink must never turn an optional launch route into a crash.
  }
}
