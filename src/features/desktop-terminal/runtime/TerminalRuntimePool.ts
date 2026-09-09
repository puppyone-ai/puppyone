import type { MessageFormatter } from "@puppyone/localization/core";
import type { AuxiliaryWorkbenchProject } from "../../app-shell/auxiliary-workbench/types";
import type { DesktopTerminalLauncherId } from "../model/terminalLaunchers";
import type { DesktopTerminalSession } from "../model/terminalSessions";
import { TerminalRuntime } from "./terminalRuntime";
import type { TerminalAppearance } from "./terminalAppearance";

export class TerminalRuntimePool {
  private entries = new Map<string, { runtime: TerminalRuntime; session: DesktopTerminalSession; listeners: Set<() => void> }>();
  constructor(private readonly project: AuxiliaryWorkbenchProject, private readonly t: MessageFormatter) {}
  ensure(id: string, launcherId: DesktopTerminalLauncherId, appearance: TerminalAppearance) {
    this.project.assertOpen();
    const existing = this.entries.get(id);
    if (existing) return existing;
    const entry = { runtime: null! as TerminalRuntime, session: { id, launcherId, ordinal: this.entries.size + 1, shell: null, status: "starting", launchError: null } as DesktopTerminalSession, listeners: new Set<() => void>() };
    entry.runtime = new TerminalRuntime({
      appearance,
      sessionId: id, launcherId, workspacePath: this.project.context.rootPath, projectContext: this.project.context, getMessageFormatter: () => this.t,
      onStatus: (_id, status, shell, error) => { entry.session = { ...entry.session, status, shell: shell ?? entry.session.shell, launchError: error ?? null }; entry.listeners.forEach((listener) => listener()); },
    });
    this.entries.set(id, entry);
    // The project owns output reception even before its first visible mount.
    const host = document.createElement("div");
    entry.runtime.mount(host);
    entry.runtime.unmount(host);
    return entry;
  }
  get(id: string) { return this.entries.get(id); }
  async close(id: string) { const entry = this.entries.get(id); if (!entry) return true; await entry.runtime.close(); this.entries.delete(id); return true; }
  discard(id: string) { return this.close(id); }
  dispose() { this.entries.forEach((entry) => entry.runtime.dispose()); this.entries.clear(); }
}
