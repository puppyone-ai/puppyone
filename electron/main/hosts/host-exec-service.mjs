/**
 * Terminals and Agents that the owner's other computers start in a folder on
 * this computer. Runs on this computer's own terminal service, so the shell,
 * PATH and Agent launchers are exactly the ones a local terminal would use.
 *
 * Every start re-reads this computer's own consent for the folder
 * (folder.shell / folder.agent). The remote side names a launcher from a fixed
 * list; it never sends a command line.
 */
export const HOST_LAUNCHERS = Object.freeze(["shell", "codex", "claude", "cursor", "opencode", "pi", "hermes"]);
const MAX_SESSIONS = 8;
const MAX_INPUT_BYTES = 64 * 1024;
const CONTROL_C = "\u0003";
// Never a real window: terminal sessions are owned per sender, and this one is ours.
const HOST_SENDER = Object.freeze({ id: 2 ** 31 + 7, isDestroyed: () => false, send() {} });

export function createHostExecService({ resolveFolder, createTerminalService, logger = console, onChange = () => {},
  // Where and how a session may run here: the folder sandbox or the whole computer; throws if neither is allowed.
  executionPolicy = null }) {
  const sessions = new Map();
  const terminals = createTerminalService({
    // Remote output never goes to a window; it goes back over the device socket.
    createOutputTransport: (session) => ({
      write: (data) => sessions.get(session.id)?.emit({ type: "exec_output", session: session.id,
        data: Buffer.from(String(data), "utf8").toString("base64") }),
      exit: ({ code }) => {
        const record = sessions.get(session.id);
        if (!record) return;
        sessions.delete(session.id);
        record.emit({ type: "exec_exit", session: session.id, status: Number.isInteger(code) ? code : null });
        notify();
      },
      resize() {},
    }),
  });

  function notify() {
    try { onChange(list()); } catch { /* Status observers never control sessions. */ }
  }

  function list() {
    return [...sessions.values()].map(({ id, folderId, kind, launcher, tier, startedAt }) =>
      ({ session: id, folderId, kind, launcher, tier, startedAt }));
  }

  async function open(message, emit) {
    const { session: id, folder_id: folderId, kind, launcher } = message ?? {};
    const fail = (error) => emit({ type: "exec_failed", session: id, error });
    if (typeof id !== "string" || !["shell", "agent"].includes(kind) || !HOST_LAUNCHERS.includes(launcher) ||
        (kind === "agent") === (launcher === "shell")) return fail("not_allowed");
    if (sessions.size >= MAX_SESSIONS) return fail("session_limit");
    const folder = await resolveFolder(folderId);
    if (!folder) return fail("folder_unavailable");
    if (!folder.capabilities?.includes(kind === "shell" ? "folder.shell" : "folder.agent")) return fail("not_allowed");
    let policy;
    try {
      if (!executionPolicy) throw Object.assign(new Error("No execution policy."), { code: "sandbox_unavailable" });
      policy = await executionPolicy({ folderId, launcher, rootPath: folder.rootPath });
    } catch (error) {
      return fail(error?.code === "sandbox_unavailable" ? "sandbox_unavailable" : "not_allowed");
    }
    const record = { id, folderId, kind, launcher, emit, tier: policy.tier, startedAt: new Date().toISOString() };
    sessions.set(id, record);
    try {
      await terminals.create(HOST_SENDER, { id, launcherId: launcher, cols: message.cols, rows: message.rows, policy },
        folder.rootPath);
    } catch (error) {
      sessions.delete(id);
      const missing = /AGENT|not found|ENOENT|unavailable/i.test(String(error?.message ?? ""));
      logger.warn?.("Remote terminal could not start", { kind, launcher });
      return fail(kind === "agent" && missing ? "launcher_unavailable" : "folder_unavailable");
    }
    emit({ type: "exec_opened", session: id });
    notify();
  }

  function input(message) {
    if (!sessions.has(message?.session) || typeof message.data !== "string") return;
    const bytes = Buffer.from(message.data, "base64");
    if (bytes.length === 0 || bytes.length > MAX_INPUT_BYTES) return;
    terminals.input(HOST_SENDER, { id: message.session, data: bytes.toString("utf8") });
  }

  function resize(message) {
    if (sessions.has(message?.session)) terminals.resize(HOST_SENDER, { id: message.session, cols: message.cols, rows: message.rows });
  }

  async function close(id) {
    if (!sessions.has(id)) return;
    await terminals.close(HOST_SENDER, { id }).catch(() => {});
  }

  function signal(message) {
    if (!sessions.has(message?.session)) return;
    if (message.signal === "INT") terminals.input(HOST_SENDER, { id: message.session, data: CONTROL_C });
    else void close(message.session);
  }

  /** Device frames: returns false for anything that is not an exec frame. */
  function receive(message, emit) {
    switch (message?.type) {
      case "exec_open": void open(message, emit).catch(() => emit({ type: "exec_failed", session: message.session, error: "folder_unavailable" })); return true;
      case "exec_input": input(message); return true;
      case "exec_resize": resize(message); return true;
      case "exec_signal": signal(message); return true;
      case "exec_close": void close(message.session); return true;
      default: return false;
    }
  }

  async function stopAll() {
    await Promise.all([...sessions.keys()].map((id) => close(id)));
  }

  /** A folder whose permission changed: end what it no longer allows. */
  async function enforce(folderId) {
    const folder = await resolveFolder(folderId);
    await Promise.all([...sessions.values()].filter((record) => record.folderId === folderId &&
      !folder?.capabilities?.includes(record.kind === "shell" ? "folder.shell" : "folder.agent"))
      .map((record) => close(record.id)));
  }

  /** End sessions that ran at a tier this computer no longer allows. */
  async function enforceTier(allowed) {
    await Promise.all([...sessions.values()].filter((record) => !allowed(record.tier)).map((record) => close(record.id)));
  }

  return Object.freeze({ receive, stopAll, enforce, enforceTier, list, close });
}
