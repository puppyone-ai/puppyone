import { randomUUID } from "node:crypto";
import path from "node:path";
import pty from "node-pty";
import {
  createTerminalAgentLaunchResolver,
  isTerminalAgentLauncherId,
} from "./terminal-agent/terminal-agent-launch-resolver.mjs";
import {
  createTerminalShellHost,
  isTerminalAgentDisplayReady,
} from "./terminal-shell-host.mjs";
import { resolveCanonicalWorkspaceDirectory } from "./workspace-authorization.mjs";

const DEFAULT_AGENT_REVEAL_TIMEOUT_MS = 2_400;
const TERMINAL_DEFAULT_COLOR_QUERIES = Object.freeze([
  { sequence: "\u001b]10;?\u001b\\", slot: 10 },
  { sequence: "\u001b]10;?\u0007", slot: 10 },
  { sequence: "\u001b]11;?\u001b\\", slot: 11 },
  { sequence: "\u001b]11;?\u0007", slot: 11 },
  { sequence: "\u009d10;?\u009c", slot: 10 },
  { sequence: "\u009d11;?\u009c", slot: 11 },
]);

export function createTerminalService({
  appVersion,
  environment = process.env,
  initializeWorkspaceEditReview,
  logger = console,
  platform = process.platform,
  ptyService = pty,
  resolveTerminalAgentLaunch = createTerminalAgentLaunchResolver({
    env: environment,
    platform,
  }),
  terminalAgentActivityHost = null,
  agentRevealTimeoutMs = DEFAULT_AGENT_REVEAL_TIMEOUT_MS,
}) {
  const sessions = new Map();

  async function create(sender, request, workspaceRoot = null) {
    const senderId = requireSenderId(sender);
    if (typeof workspaceRoot !== "string" || workspaceRoot.trim().length === 0) {
      throw new Error("No local workspace is assigned to this window.");
    }
    const cwd = await resolveCanonicalWorkspaceDirectory(
      workspaceRoot,
      request?.cwd ?? workspaceRoot,
      { label: "Terminal cwd" },
    );
    const id = normalizeTerminalId(request?.id);
    const cols = normalizeTerminalSize(request?.cols, 80, 20, 400);
    const rows = normalizeTerminalSize(request?.rows, 24, 8, 120);
    const spawnConfig = await resolveTerminalSpawnConfig(
      request?.launcherId,
      { environment, platform, resolveTerminalAgentLaunch },
    );

    const existing = get(id);
    if (existing && existing.sender.id !== senderId) {
      throw new Error("Terminal session id is already owned by another window.");
    }
    if (existing) closeSession(existing);
    await initializeWorkspaceEditReview(workspaceRoot).catch((error) => {
      logger.warn("Unable to initialize edit review baseline:", error);
    });

    let activityPreparation = null;
    if (terminalAgentActivityHost) {
      try {
        activityPreparation = await terminalAgentActivityHost?.prepareTerminalSession?.({
          terminalSessionId: id,
          providerId: request?.launcherId ?? "shell",
          workspaceRoot,
          webContentsId: senderId,
        });
      } catch (error) {
        logger.warn("Unable to prepare Terminal Agent activity; continuing without it:", error);
      }
    }

    let terminal;
    try {
      const terminalEnvironment = {
        ...buildTerminalEnvironment(environment, {
          appVersion,
          defaultColors: request?.defaultColors,
          freshLoginShell: spawnConfig.loginShell,
          platform,
        }),
        ...(activityPreparation?.environment ?? {}),
      };
      terminal = ptyService.spawn(spawnConfig.file, spawnConfig.args, {
        name: "xterm-256color",
        cwd,
        cols,
        rows,
        env: prependTerminalPathEntries(
          terminalEnvironment,
          spawnConfig.pathEntries,
          platform,
        ),
      });
    } catch (error) {
      terminalAgentActivityHost?.closeTerminalSession?.(id);
      throw new Error(`Failed to start terminal: ${error instanceof Error ? error.message : String(error)}`);
    }

    const session = {
      id,
      terminal,
      sender,
      workspaceRoot: path.resolve(workspaceRoot),
      cols,
      rows,
      defaultColorResponder: createTerminalDefaultColorResponder(request?.defaultColors),
    };

    sessions.set(id, session);

    const agentRevealGate = spawnConfig.kind === "agent"
      ? createAgentRevealGate(agentRevealTimeoutMs)
      : null;
    terminal.onData((data) => {
      const handled = session.defaultColorResponder?.process(data) ?? {
        data: String(data),
        replies: [],
      };
      try {
        handled.replies.forEach((reply) => terminal.write(reply));
      } catch (error) {
        logger.warn("Unable to answer terminal default-color query:", error);
        sendTerminalData(session, data);
        agentRevealGate?.observe(data);
        return;
      }
      if (handled.data.length > 0) sendTerminalData(session, handled.data);
      agentRevealGate?.observe(data);
    });
    terminal.onExit(({ exitCode, signal }) => {
      const trailingData = session.defaultColorResponder?.flush() ?? "";
      if (trailingData.length > 0) sendTerminalData(session, trailingData);
      agentRevealGate?.settle();
      sendTerminalExit(session, exitCode, signal ? String(signal) : null);
      if (sessions.get(id) === session) sessions.delete(id);
      terminalAgentActivityHost?.closeTerminalSession?.(id);
    });

    if (spawnConfig.agentBootstrapInput) {
      try {
        agentRevealGate?.begin();
        terminal.write(spawnConfig.agentBootstrapInput);
      } catch (error) {
        agentRevealGate?.settle();
        closeSession(session);
        throw new Error(`TERMINAL_AGENT_START_FAILED: ${error instanceof Error ? error.message : String(error)}`);
      }
      await agentRevealGate?.wait();
    }

    return {
      id,
      pid: terminal.pid ?? null,
      shell: spawnConfig.displayShell,
      inputShell: spawnConfig.file,
      cwd,
    };
  }

  function input(sender, request) {
    const session = getOwnedSession(sender, request?.id);
    const data = request?.data;
    if (!session || typeof data !== "string" || data.length === 0) return false;
    session.terminal.write(data);
    return true;
  }

  function resize(sender, request) {
    const session = getOwnedSession(sender, request?.id);
    if (!session) return false;
    const cols = normalizeTerminalSize(request?.cols, 80, 20, 400);
    const rows = normalizeTerminalSize(request?.rows, 24, 8, 120);
    session.cols = cols;
    session.rows = rows;
    session.terminal.resize(cols, rows);
    return true;
  }

  function appearance(sender, request) {
    const session = getOwnedSession(sender, request?.id);
    if (!session) return false;
    if (session.defaultColorResponder?.updateColors(request?.defaultColors)) return true;
    const responder = createTerminalDefaultColorResponder(request?.defaultColors);
    if (!responder) return false;
    session.defaultColorResponder = responder;
    return true;
  }

  function close(sender, id) {
    const session = getOwnedSession(sender, id);
    if (!session) return false;
    closeSession(session);
    return true;
  }

  function closeSession(session) {
    sessions.delete(session.id);
    terminalAgentActivityHost?.closeTerminalSession?.(session.id);
    try {
      session.terminal.kill();
    } catch {
      // The PTY may already be gone.
    }
  }

  function closeSessionsForWindow(webContentsId) {
    for (const session of Array.from(sessions.values())) {
      if (session.sender.id === webContentsId) {
        closeSession(session);
      }
    }
  }

  function closeSessionsForWorkspaceRoot(webContentsId, workspaceRoot) {
    const canonicalRoot = typeof workspaceRoot === "string" && workspaceRoot.trim()
      ? path.resolve(workspaceRoot)
      : null;
    if (!Number.isInteger(webContentsId) || !canonicalRoot) return 0;
    let closed = 0;
    for (const session of Array.from(sessions.values())) {
      if (session.sender.id !== webContentsId || session.workspaceRoot !== canonicalRoot) continue;
      closeSession(session);
      closed += 1;
    }
    return closed;
  }

  function closeAll() {
    for (const session of Array.from(sessions.values())) {
      closeSession(session);
    }
  }

  function getSessionCount() {
    return sessions.size;
  }

  function get(id) {
    if (typeof id !== "string") return null;
    return sessions.get(id) ?? null;
  }

  function getOwnedSession(sender, id) {
    const session = get(id);
    return session && sender?.id === session.sender.id ? session : null;
  }

  return {
    create,
    input,
    resize,
    appearance,
    close,
    closeSessionsForWindow,
    closeSessionsForWorkspaceRoot,
    closeAll,
    getSessionCount,
  };
}

export function createTerminalDefaultColorResponder(value) {
  let colors = normalizeTerminalDefaultColors(value);
  if (!colors) return null;
  let carry = "";

  return {
    process(data) {
      const source = `${carry}${String(data)}`;
      const replies = [];
      let output = "";
      let cursor = 0;
      carry = "";

      while (cursor < source.length) {
        const match = findNextTerminalDefaultColorQuery(source, cursor);
        if (!match) {
          const remainder = source.slice(cursor);
          const carryLength = longestTerminalDefaultColorQueryPrefixSuffix(remainder);
          output += remainder.slice(0, remainder.length - carryLength);
          carry = remainder.slice(remainder.length - carryLength);
          break;
        }
        output += source.slice(cursor, match.index);
        replies.push(formatTerminalDefaultColorReply(match.slot, colors));
        cursor = match.index + match.sequence.length;
      }

      return { data: output, replies };
    },
    flush() {
      const data = carry;
      carry = "";
      return data;
    },
    updateColors(nextValue) {
      const nextColors = normalizeTerminalDefaultColors(nextValue);
      if (!nextColors) return false;
      colors = nextColors;
      return true;
    },
  };
}

function normalizeTerminalDefaultColors(value) {
  const foreground = normalizeTerminalRgb(value?.foreground);
  const background = normalizeTerminalRgb(value?.background);
  return foreground && background ? { foreground, background } : null;
}

function normalizeTerminalRgb(value) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const channels = value.map(Number);
  if (channels.some((channel) => (
    !Number.isInteger(channel) || channel < 0 || channel > 255
  ))) return null;
  return channels;
}

function findNextTerminalDefaultColorQuery(source, cursor) {
  let result = null;
  for (const query of TERMINAL_DEFAULT_COLOR_QUERIES) {
    const index = source.indexOf(query.sequence, cursor);
    if (index !== -1 && (!result || index < result.index)) {
      result = { ...query, index };
    }
  }
  return result;
}

function longestTerminalDefaultColorQueryPrefixSuffix(value) {
  const maxLength = Math.min(
    value.length,
    Math.max(...TERMINAL_DEFAULT_COLOR_QUERIES.map(({ sequence }) => sequence.length)) - 1,
  );
  for (let length = maxLength; length > 0; length -= 1) {
    const suffix = value.slice(-length);
    if (TERMINAL_DEFAULT_COLOR_QUERIES.some(({ sequence }) => sequence.startsWith(suffix))) {
      return length;
    }
  }
  return 0;
}

function formatTerminalDefaultColorReply(slot, colors) {
  const color = slot === 10 ? colors.foreground : colors.background;
  const components = color.map((channel) => {
    const hex = channel.toString(16).padStart(2, "0");
    return `${hex}${hex}`;
  });
  return `\u001b]${slot};rgb:${components.join("/")}\u001b\\`;
}

function createAgentRevealGate(timeoutValue) {
  const timeoutMs = normalizeAgentRevealTimeout(timeoutValue);
  let buffer = "";
  let started = false;
  let settled = false;
  let timer = null;
  let resolveWait;
  const waitPromise = new Promise((resolve) => {
    resolveWait = resolve;
  });

  const settle = () => {
    if (settled) return;
    settled = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    resolveWait();
  };

  return {
    begin() {
      if (started || settled) return;
      started = true;
      if (timeoutMs === 0) {
        settle();
        return;
      }
      timer = setTimeout(settle, timeoutMs);
    },
    observe(data) {
      if (!started || settled) return;
      buffer = `${buffer}${String(data)}`.slice(-8_192);
      if (isTerminalAgentDisplayReady(buffer)) settle();
    },
    settle,
    wait() {
      return waitPromise;
    },
  };
}

function normalizeAgentRevealTimeout(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return DEFAULT_AGENT_REVEAL_TIMEOUT_MS;
  return Math.min(Math.max(Math.round(milliseconds), 0), 5_000);
}

function requireSenderId(sender) {
  const senderId = sender?.id;
  if (!Number.isSafeInteger(senderId) || senderId <= 0) {
    throw new Error("Terminal sender is invalid.");
  }
  return senderId;
}

function normalizeTerminalId(id) {
  if (typeof id === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(id)) {
    return id;
  }
  return randomUUID();
}

function normalizeTerminalSize(value, fallback, min, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(Math.max(Math.round(next), min), max);
}

async function resolveTerminalSpawnConfig(
  launcherId,
  { environment, platform, resolveTerminalAgentLaunch },
) {
  if (launcherId === undefined || launcherId === null || launcherId === "shell") {
    return createTerminalShellHost({ environment, platform });
  }
  if (!isTerminalAgentLauncherId(launcherId)) {
    throw new Error("TERMINAL_AGENT_UNAVAILABLE");
  }
  const launch = await resolveTerminalAgentLaunch(launcherId);
  return createTerminalShellHost({ agentLaunch: launch, environment, platform });
}

export function prependTerminalPathEntries(environment, entries, platform = process.platform) {
  if (!Array.isArray(entries) || entries.length === 0) return environment;
  const separator = platform === "win32" ? ";" : ":";
  const validEntries = entries.filter((entry) => (
    typeof entry === "string"
    && path.isAbsolute(entry)
    && entry.length <= 4_096
    && !/[\r\n\0]/u.test(entry)
  ));
  if (validEntries.length === 0) return environment;
  const currentEntries = String(environment.PATH || "").split(separator).filter(Boolean);
  return {
    ...environment,
    PATH: Array.from(new Set([...validEntries, ...currentEntries])).join(separator),
  };
}

const NPM_LIFECYCLE_KEYS = new Set([
  "INIT_CWD",
  "NPM_COMMAND",
  "NPM_EXECPATH",
  "NPM_NODE_EXECPATH",
]);

export function buildTerminalEnvironment(source, {
  appVersion,
  defaultColors,
  platform = process.platform,
  freshLoginShell = platform !== "win32",
} = {}) {
  const entries = Object.entries(source ?? {})
    .filter(([, value]) => typeof value === "string");
  const condaPrefixes = freshLoginShell
    ? entries
      .filter(([key, value]) => /^CONDA_PREFIX(?:_\d+)?$/i.test(key) && value)
      .map(([, value]) => value)
    : [];
  const env = {};

  for (const [key, value] of entries) {
    const canonicalKey = key.toUpperCase();
    if (canonicalKey === "NO_COLOR") continue;
    if (canonicalKey === "COLORFGBG") continue;
    if (isNpmLifecycleKey(canonicalKey) || canonicalKey === "NPM_CONFIG_PREFIX") continue;
    if (canonicalKey === "PREFIX") continue;
    if (freshLoginShell && isCondaActivationKey(canonicalKey)) continue;
    env[key] = value;
  }

  if (freshLoginShell && typeof env.PATH === "string" && condaPrefixes.length > 0) {
    env.PATH = removeCondaActivationPaths(env.PATH, condaPrefixes, platform);
  }

  const colorFgBg = terminalColorFgBg(defaultColors);
  return {
    ...env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    CLICOLOR: env.CLICOLOR || "1",
    TERM_PROGRAM: "PuppyOne",
    TERM_PROGRAM_VERSION: appVersion,
    PUPPYONE_TERMINAL: "1",
    ...(colorFgBg ? { COLORFGBG: colorFgBg } : {}),
  };
}

export function terminalColorFgBg(value) {
  const colors = normalizeTerminalDefaultColors(value);
  if (!colors) return null;
  return relativeLuminance(colors.background) < 0.5 ? "15;0" : "0;15";
}

function relativeLuminance(color) {
  const channels = color.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function isNpmLifecycleKey(key) {
  const canonicalKey = key.toUpperCase();
  return NPM_LIFECYCLE_KEYS.has(canonicalKey)
    || canonicalKey.startsWith("NPM_LIFECYCLE_")
    || canonicalKey.startsWith("NPM_PACKAGE_");
}

function isCondaActivationKey(key) {
  return key === "CONDA_PREFIX"
    || /^CONDA_PREFIX_\d+$/.test(key)
    || key === "CONDA_SHLVL"
    || key === "CONDA_DEFAULT_ENV"
    || key === "CONDA_PROMPT_MODIFIER"
    || key === "CONDA_PATH_BACKUP"
    || key === "CONDA_PS1_BACKUP"
    || /^CONDA_STACKED_\d+$/.test(key)
    || /^__CONDA_SHLVL_\d+_/.test(key);
}

function removeCondaActivationPaths(value, prefixes, platform) {
  const separator = platform === "win32" ? ";" : ":";
  const pathModule = platform === "win32" ? path.win32 : path.posix;
  const targets = new Set();
  for (const prefix of prefixes) {
    const candidatePaths = platform === "win32"
      ? [
          prefix,
          pathModule.join(prefix, "Library", "mingw-w64", "bin"),
          pathModule.join(prefix, "Library", "usr", "bin"),
          pathModule.join(prefix, "Library", "bin"),
          pathModule.join(prefix, "Scripts"),
          pathModule.join(prefix, "bin"),
        ]
      : [pathModule.join(prefix, "bin")];
    for (const candidate of candidatePaths) {
      targets.add(normalizePathEntry(candidate, platform));
    }
  }

  return value
    .split(separator)
    .filter((entry) => !targets.has(normalizePathEntry(entry, platform)))
    .join(separator);
}

function normalizePathEntry(value, platform) {
  const normalized = String(value).replace(/[\\/]+$/u, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sendTerminalData(session, data) {
  if (session.sender.isDestroyed()) return;
  session.sender.send("terminal:data", {
    id: session.id,
    data: String(data),
  });
}

function sendTerminalExit(session, code, signal) {
  if (session.sender.isDestroyed()) return;
  session.sender.send("terminal:exit", {
    id: session.id,
    code,
    signal,
  });
}
