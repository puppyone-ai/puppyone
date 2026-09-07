import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { MessageFormatter } from "@puppyone/localization/core";
import type { AuxiliaryWorkbenchContribution, AuxiliaryWorkbenchItemRenderContext, AuxiliaryWorkbenchProject } from "../../app-shell/auxiliary-workbench/types";
import { DESKTOP_TERMINAL_LAUNCHERS } from "../model/terminalLaunchers";
import { presentTerminalSessionHeader } from "../model/terminalSessionHeader";
import { TerminalRuntimePool } from "../runtime/TerminalRuntimePool";
import { TerminalSessionView } from "../ui/TerminalSessionView";
import { TerminalSessionHeaderStatus } from "../ui/session-header/TerminalSessionHeaderStatus";
import { getTerminalClosePolicy } from "../model/terminalClosePolicy";
import { useTerminalAppearanceSync } from "../runtime/useTerminalAppearanceSync";
import "@xterm/xterm/css/xterm.css";
import "../ui/desktop-terminal.css";


function requirePool(project: AuxiliaryWorkbenchProject | undefined, t: MessageFormatter) {
  if (!project) throw new Error("Terminal requires an open project context.");
  return project.getResource("terminal", () => new TerminalRuntimePool(project, t));
}

export function createTerminalWorkbenchContribution(t: MessageFormatter): AuxiliaryWorkbenchContribution {
  return {
    kind: "terminal", label: t("terminal.title"), createLabel: t("terminal.new"), minimumSize: { width: 280, height: 260 }, maximumItems: 32,
    initialSnapshot: { title: t("terminal.title"), accessibleLabel: t("terminal.title"), detail: null, iconKey: null, status: "starting", running: false, resourceId: null },
    getMinimumSize: ({ project, item }) => requirePool(project, t).get(item.id)?.runtime.getMinimumViewportSize() ?? null,
    creationRecipes: DESKTOP_TERMINAL_LAUNCHERS.map((launcher) => ({ id: launcher.id, label: t(launcher.nameMessage), iconKey: launcher.id, status: "available" })),
    prepare: async ({ project, item, recipe }) => {
      const launcher = DESKTOP_TERMINAL_LAUNCHERS.find((entry) => entry.id === recipe?.id);
      if (!launcher) throw new Error("Unknown terminal launcher.");
      requirePool(project, t).ensure(item.id, launcher.id);
    },
    discardPreparedItem: async ({ project, item }) => { if (!project?.disposed) await requirePool(project, t).discard(item.id); },
    renderItem: (context) => <TerminalWorkbenchItem {...context} t={t} />,
    renderStatus: ({ project, item }) => {
      if (project?.disposed) return null;
      const entry = requirePool(project, t).get(item.id);
      return entry ? <TerminalSessionHeaderStatus className="desktop-terminal-tab-status" runtime={entry.runtime} session={entry.session} /> : null;
    },
    close: {
      decide: ({ snapshot }) => getTerminalClosePolicy(snapshot.status === "idle" ? "exited" : snapshot.status) === "close" ? { kind: "close" } : {
        kind: "confirm", tone: "danger", dialog: { title: t("terminal.closeDialog.title", { title: snapshot.title }), detail: t("terminal.closeDialog.detail"), actionLabel: t("terminal.closeDialog.confirm") },
      },
      commit: ({ project, item }) => requirePool(project, t).close(item.id),
    },
  };
}

function TerminalWorkbenchItem({ project, item, presentation, onPresentationChange, t }: AuxiliaryWorkbenchItemRenderContext & { t: MessageFormatter }) {
  const entry = requirePool(project, t).get(item.id);
  if (!entry) throw new Error("Terminal runtime is missing.");
  const host = useRef<HTMLDivElement>(null);
  const appearance = useMemo(() => ({ applyAppearance: () => entry.runtime.applyAppearance() }), [entry]);
  useTerminalAppearanceSync(host, appearance);
  const session = useSyncExternalStore((listener) => { entry.listeners.add(listener); return () => { entry.listeners.delete(listener); }; }, () => entry.session);
  useEffect(() => {
    const header = presentTerminalSessionHeader(session, item.rootId, t);
    onPresentationChange({ title: header.pathLabel, accessibleLabel: header.accessibleLabel, detail: header.overflowDetail, iconKey: session.launcherId, status: session.status, running: session.status === "running", resourceId: null });
  }, [item.rootId, onPresentationChange, session, t]);
  return <div ref={host} className="desktop-terminal-session-host-content">
    <TerminalSessionView runtime={entry.runtime} workspacePath={item.rootId} presented={presentation.presented} focused={presentation.commandTarget} />
    {session.launchError && <div className="desktop-terminal-drop-error" role="alert">{session.launchError}</div>}
  </div>;
}
