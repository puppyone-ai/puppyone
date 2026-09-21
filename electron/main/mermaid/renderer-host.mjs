import { randomUUID } from "node:crypto";

/** A detached WebContentsView avoids adding hidden application windows. A
 * private, non-persistent session keeps this renderer out of the UI process. */
export function createMermaidRendererHost({ WebContentsView, session, url, preload }) {
  const isolatedSession = session.fromPartition(`mermaid-${randomUUID()}`);
  const base = new URL(".", url);
  isolatedSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try {
      const target = new URL(details.url);
      const local = target.protocol === base.protocol && target.host === base.host
        && target.pathname.startsWith(base.pathname);
      allowed = local && ["mainFrame", "script", "stylesheet", "font"].includes(details.resourceType);
    } catch { /* deny */ }
    callback({ cancel: !allowed });
  });
  const view = new WebContentsView({ webPreferences: {
    session: isolatedSession, preload, sandbox: true, contextIsolation: true,
    nodeIntegration: false, webSecurity: true, backgroundThrottling: false,
  } });
  const contents = view.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-attach-webview", (event) => event.preventDefault());
  let pending = null;
  let stopped = false;
  let stopping = null;
  const fail = () => { pending?.reject(new Error("Diagram renderer exited.")); pending = null; };
  contents.on("render-process-gone", fail);
  contents.on("destroyed", fail);
  contents.ipc.on("mermaid-host:result", (event, result) => {
    if (event.senderFrame !== contents.mainFrame || !pending || result?.id !== pending.id) return;
    const run = pending; pending = null;
    if (result.ok && typeof result.svg === "string" && Buffer.byteLength(result.svg) <= 4 * 1024 * 1024) {
      run.resolve({ svg: result.svg, timings: result.timings });
    } else if (result.ok === false && typeof result.error === "string") {
      run.resolve({ ok: false, error: result.error.slice(0, 512) });
    } else run.reject(new Error("Invalid diagram renderer result."));
  });
  const ready = contents.loadURL(url);
  void ready.catch(() => undefined);
  return {
    async render(request) {
      await ready;
      // Retain the View wrapper as well as webContents for the host lifetime.
      if (stopped || view.webContents.isDestroyed()) throw new Error("Diagram renderer exited.");
      return new Promise((resolve, reject) => {
        pending = { id: request.id, resolve, reject };
        contents.send("mermaid-host:render", request);
      });
    },
    stop() {
      if (stopping) return stopping;
      stopped = true;
      stopping = new Promise((resolve, reject) => {
        if (contents.isDestroyed()) { resolve(); return; }
        const timer = setTimeout(() => reject(new Error("Diagram renderer exit was not confirmed.")), 2_000);
        const exited = () => {
          if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false });
        };
        contents.once("destroyed", () => {
          clearTimeout(timer); isolatedSession.webRequest.onBeforeRequest(null); resolve();
        });
        contents.once("render-process-gone", exited);
        // This host has its own session/process. Killing it cannot kill a UI pane.
        if (contents.getOSProcessId()) contents.forcefullyCrashRenderer();
        else contents.close({ waitForBeforeUnload: false });
      }).catch((error) => { stopping = null; throw error; });
      return stopping;
    },
  };
}
