import { randomUUID } from "node:crypto";
import path from "node:path";
import { isWorkspaceResourceReference, parseWorkspaceResourceReference } from "../../shared/workspace-resource-reference.mjs";

/** One owner for native tracking, source identity, drop admission and disposal. */
export function createResourceDragSessionService({ native, resolveEntries, getWindow, now = Date.now, settleMs = 5000 }) {
  const sessions = new Map();
  let active = null;

  const discard = (session, error) => {
    if (session.invalid) return;
    clearTimeout(session.timer);
    session.disposeListeners?.();
    sessions.delete(session.id);
    if (active === session) active = null;
    session.invalid = error ?? new Error("The drag session has ended.");
    session.resolveEnd(null);
    notify(session, null);
  };
  const notify = (session, value) => {
    for (const sender of session.recipients ?? []) {
      if (!sender.isDestroyed()) sender.send("resource-transfer:state", value ?? { id: session.id, entries: null });
    }
  };
  const revalidate = async (session, event) => {
    if (session.invalid || session.event.sender.isDestroyed() || event.sender.isDestroyed()) {
      throw session.invalid ?? new Error("The drag source or destination is unavailable.");
    }
    const source = await resolveEntries(session.event, session.request);
    const target = await resolveEntries(event, { resources: source.map((entry) => entry.resourceUri) });
    if (session.invalid || source.some((entry, index) => entry.absolutePath !== session.entries[index]?.absolutePath)
      || target.some((entry, index) => entry.absolutePath !== source[index]?.absolutePath)) {
      throw new Error("The drag source changed or is no longer authorized.");
    }
    return target;
  };
  const current = () => {
    const id = native.inspect();
    const session = sessions.get(id);
    if (!session || session.invalid || (session.endedAt && now() - session.endedAt > settleMs)) return null;
    return session;
  };

  return {
    async start(event, request) {
      if (active) throw new Error("A resource drag is already in progress.");
      const sourceWindow = getWindow(event.sender);
      if (!sourceWindow || sourceWindow.isDestroyed()) return false;
      const gesture = native.captureGesture(sourceWindow.getNativeWindowHandle());
      if (!gesture) return false;
      const session = { id: randomUUID(), event, request: structuredClone(request), entries: [], claimed: false, recipients: new Set([event.sender]) };
      session.end = new Promise((resolve) => { session.resolveEnd = resolve; });
      active = session; // Reserve before any asynchronous authorization.
      sessions.set(session.id, session);
      const invalidate = () => discard(session, new Error("The source window was closed or navigated."));
      event.sender.once("destroyed", invalidate);
      const navigation = (details, _url, _inPlace, isMainFrame) => { if (details.isMainFrame ?? isMainFrame) invalidate(); };
      event.sender.on("did-start-navigation", navigation);
      session.disposeListeners = () => {
        event.sender.removeListener("destroyed", invalidate);
        event.sender.removeListener("did-start-navigation", navigation);
      };
      try {
        session.entries = await resolveEntries(event, request);
        await revalidate(session, event);
        const window = getWindow(event.sender);
        if (!window || window.isDestroyed() || session.invalid) throw new Error("The drag source is unavailable.");
        const started = native.start(window.getNativeWindowHandle(), session.entries.map((entry) => entry.absolutePath), session.id, (end) => {
          if (session.invalid) return;
          session.endedAt = now();
          session.result = end;
          if (active === session) active = null;
          session.resolveEnd(end);
          notify(session, null);
          if (!end.operation) discard(session, new Error("The drag was cancelled or rejected."));
          else { session.timer = setTimeout(() => discard(session), settleMs); session.timer.unref?.(); }
        }, gesture);
        if (!started) { discard(session); return false; }
        notify(session, { id: session.id, entries: session.entries.map(toPublicEntry) });
        return true;
      } catch (error) { discard(session, error); throw error; }
    },

    async preview(event) {
      const session = current();
      if (!session || session.endedAt || session.claimed) return null;
      const entries = await revalidate(session, event);
      if (session.endedAt || session.invalid) return null;
      session.recipients.add(event.sender);
      return { id: session.id, entries: entries.map(toPublicEntry) };
    },

    async claim(event, request) {
      const session = current();
      if (!session) {
        if (native.inspect()) throw new Error("This resource drag has expired or already ended.");
        return null; // Genuine external drops retain their import behavior.
      }
      if (session.claimed) throw new Error("This drag has already been consumed.");
      if (!["explorer-move", "editor-split", "terminal-path", "agent-reference"].includes(request?.intent)) throw new Error("Unknown drop intent.");
      const files = request.paths;
      if (!Array.isArray(files) || files.some((file) => typeof file !== "string")) {
        throw new Error("The native drop payload does not match its source.");
      }
      const identifiedEditorSplit = request.intent === "editor-split"
        && files.length === 0
        && session.entries.length === 1
        && request.sessionId === session.id
        && session.recipients.has(event.sender);
      if (!identifiedEditorSplit) {
        const expected = session.entries.map((entry) => entry.absolutePath).sort();
        if (files.length !== expected.length
          || [...files].sort().some((file, index) => file !== expected[index])) {
          throw new Error("The native drop payload does not match its source.");
        }
      }
      session.claimed = true; // Reserve synchronously; a second target cannot consume it.
      const targetWindow = getWindow(event.sender);
      try {
        const ended = await session.end;
        if (!ended?.operation || !targetWindow || targetWindow.isDestroyed()
          || ended.windowNumber !== native.windowNumber(targetWindow.getNativeWindowHandle())) {
          throw new Error("The drop did not complete in this window.");
        }
        const entries = await revalidate(session, event);
        if (request.intent === "explorer-move") {
          // Reads/export may follow an in-root symlink. A move must never turn
          // a selected alias (or a file replaced by an alias) into its target.
          if (entries.some((entry, index) => {
            const original = session.request.resources[index];
            const selectedPath = isWorkspaceResourceReference(original)
              ? parseWorkspaceResourceReference(original).relativePath : original;
            return selectedPath !== entry.relativePath;
          })) throw new Error("The selected move source resolves through a different path.");
          const [target] = await resolveEntries(event, { resources: [request.targetResource] });
          if (target.entryType !== "directory" || entries.some((entry) => {
            const relative = path.relative(entry.absolutePath, target.absolutePath);
            return entry.relativePath === "." || entry.folderId !== target.folderId
              || path.dirname(entry.absolutePath) === target.absolutePath
              || relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
          })) throw new Error("This folder is not a valid move destination.");
        }
        return { entries: entries.map(toPublicEntry) };
      } finally { discard(session); }
    },

    dispose() { for (const session of [...sessions.values()]) discard(session); },
  };
}

function toPublicEntry(entry) {
  return { path: entry.resourceUri, name: path.basename(entry.absolutePath), entryType: entry.entryType };
}
