import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useLocalization } from "@puppyone/localization";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { HostLauncher, HostTerminalEvent } from "../../../../shared/host-contract/types";

type TerminalState = "starting" | "running" | "ended" | "failed";

function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * A terminal (or an Agent launcher) running in a folder on another of the
 * owner's computers. Keystrokes go to that computer; nothing runs here.
 * Closing the panel ends the session there.
 */
export function RemoteTerminalPanel({ folderId, kind, launcher, session, hostName }: {
  folderId: string; kind: "shell" | "agent"; launcher: HostLauncher; session: DesktopCloudSession; hostName: string;
}) {
  const { t } = useLocalization();
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<TerminalState>("starting");
  const [detail, setDetail] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const bridge = window.puppyoneDesktop;
    const element = container.current;
    if (!bridge?.openHostTerminal || !element) return;
    const id = crypto.randomUUID();
    const terminal = new Terminal({ convertEol: false, cursorBlink: true, scrollback: 5000 });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    try { fit.fit(); } catch { /* A hidden panel has no size yet. */ }
    let closed = false;
    setState("starting"); setDetail(null);
    const unsubscribe = bridge.onHostTerminalEvent((event: HostTerminalEvent) => {
      if (event.id !== id) return;
      if (event.type === "started") setState("running");
      else if (event.type === "output") terminal.write(decode(event.data));
      else if (event.type === "exit") { setState("ended"); setDetail(t("hosts.terminal.exited", { status: String(event.status ?? "—") })); }
      else if (event.type === "error") { setState("failed"); setDetail(t(`hosts.terminal.error.${event.code}`, { host: hostName })); }
      else if (event.type === "closed") setState((current) => current === "running" || current === "starting" ? "ended" : current);
    });
    const input = terminal.onData((data) => { void bridge.writeHostTerminal({ id, data }); });
    const resize = new ResizeObserver(() => {
      try { fit.fit(); } catch { return; }
      void bridge.resizeHostTerminal({ id, cols: terminal.cols, rows: terminal.rows });
    });
    resize.observe(element);
    void bridge.openHostTerminal({ id, folderId, kind, launcher, cols: terminal.cols, rows: terminal.rows,
      expectedSession: { userId: session.user_id, generation: session.session_generation } })
      .catch((cause: unknown) => {
        if (closed) return;
        setState("failed");
        setDetail(cause instanceof Error ? cause.message : t("hosts.terminal.error.start_failed", { host: hostName }));
      });
    return () => {
      closed = true;
      resize.disconnect(); input.dispose(); unsubscribe();
      void bridge.closeHostTerminal({ id }).catch(() => {});
      terminal.dispose();
    };
  }, [folderId, kind, launcher, session.user_id, session.session_generation, hostName, attempt, t]);
  return <div className="desktop-remote-terminal" data-state={state}
    style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
    {(state === "ended" || state === "failed") && <div role="status" style={{ display: "flex", gap: 8, padding: "6px 8px" }}>
      <span>{detail ?? t("hosts.terminal.ended")}</span>
      <button type="button" onClick={() => setAttempt((value) => value + 1)}>{t("hosts.terminal.restart")}</button>
    </div>}
    {state === "starting" && <div role="status" style={{ padding: "6px 8px" }}>{t("hosts.terminal.starting", { host: hostName })}</div>}
    <div ref={container} style={{ flex: 1, minHeight: 0, padding: 4 }} />
  </div>;
}
