import { useEffect, useSyncExternalStore } from "react";
import type { MessageFormatter } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { useSurfaceAppearance } from "../../appearance/AppearanceRuntime";
import type { AuxiliaryWorkbenchContribution, AuxiliaryWorkbenchItemRenderContext } from "../../app-shell/auxiliary-workbench/types";
import { DESKTOP_TERMINAL_LAUNCHERS } from "../model/terminalLaunchers";
import { presentTerminalSessionHeader } from "../model/terminalSessionHeader";
import { TerminalSessionHeaderStatus } from "../ui/session-header/TerminalSessionHeaderStatus";
import { TerminalSessionView } from "../ui/TerminalSessionView";
import { getTerminalClosePolicy } from "../model/terminalClosePolicy";
import { terminalLeafMinimumSize } from "../model/terminalSplitConstraints";
import type { TerminalAppearance } from "../runtime/terminalAppearance";
import type { TerminalRuntimeEntry } from "../runtime/TerminalRuntimePool";
import { projectTerminalRuntimes } from "./projectTerminalRuntimes";
import "../ui/desktop-terminal.css";

export function createTerminalWorkbenchContribution(t: MessageFormatter, readAppearance: () => TerminalAppearance): AuxiliaryWorkbenchContribution {
  return {
    kind: "terminal", label: t("terminal.title"), createLabel: t("terminal.new"),
    minimumSize: terminalLeafMinimumSize(null), maximumItems: 32,
    initialSnapshot: { title: t("terminal.title"), accessibleLabel: t("terminal.title"), detail: null,
      iconKey: null, status: "starting", running: false, resourceId: null },
    getMinimumSize: ({ project, item }) => terminalLeafMinimumSize(projectTerminalRuntimes(project, t).get(item.id)?.runtime.getMinimumViewportSize()),
    creationRecipes: DESKTOP_TERMINAL_LAUNCHERS.map(launcher => ({ id: launcher.id, label: t(launcher.nameMessage), iconKey: launcher.id, status: "available" })),
    prepare: async ({ project, item, recipe }) => {
      const launcher = DESKTOP_TERMINAL_LAUNCHERS.find(entry => entry.id === recipe?.id);
      if (!launcher) throw new Error("Unknown terminal launcher.");
      projectTerminalRuntimes(project, t).ensure(item.id, launcher.id, readAppearance());
    },
    discardPreparedItem: async ({ project, item }) => {
      if (!project.disposed) await projectTerminalRuntimes(project, t).discard(item.id);
    },
    renderItem: context => <TerminalWorkbenchItem {...context} readAppearance={readAppearance} />,
    renderStatus: ({ project, item }) => {
      if (project.disposed) return null;
      const entry = projectTerminalRuntimes(project, t).get(item.id);
      return entry ? <TerminalStatus entry={entry} /> : null;
    },
    close: {
      decide: ({ snapshot }) => getTerminalClosePolicy(snapshot.status === "idle" ? "exited" : snapshot.status) === "close"
        ? { kind: "close" }
        : { kind: "confirm", tone: "danger", dialog: { title: t("terminal.closeDialog.title", { title: snapshot.title }),
            detail: t("terminal.closeDialog.detail"), actionLabel: t("terminal.closeDialog.confirm") } },
      commit: ({ project, item }) => projectTerminalRuntimes(project, t).close(item.id),
    },
  };
}

function useTerminalSession(entry: TerminalRuntimeEntry) {
  return useSyncExternalStore(listener => {
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); };
  }, () => entry.session);
}

function TerminalWorkbenchItem({ project, item, presentation, onPresentationChange, focusRequest,
  readAppearance }: AuxiliaryWorkbenchItemRenderContext & { readAppearance: () => TerminalAppearance }) {
  const { t } = useLocalization();
  const entry = projectTerminalRuntimes(project, t).get(item.id);
  if (!entry) throw new Error("The terminal session was not prepared.");
  return <TerminalContent entry={entry} workspacePath={project.context.rootPath} presentation={presentation}
    onPresentationChange={onPresentationChange} focusRequest={focusRequest} readAppearance={readAppearance} />;
}

function TerminalContent({ entry, workspacePath, presentation, onPresentationChange, focusRequest,
  readAppearance }: Pick<AuxiliaryWorkbenchItemRenderContext, "presentation" | "onPresentationChange" | "focusRequest"> & {
  entry: TerminalRuntimeEntry; workspacePath: string; readAppearance: () => TerminalAppearance;
}) {
  const { t } = useLocalization();
  const session = useTerminalSession(entry);
  const appearance = useSurfaceAppearance();
  useEffect(() => { entry.runtime.applyAppearance(readAppearance()); }, [appearance, entry, readAppearance]);
  useEffect(() => {
    const header = presentTerminalSessionHeader(session, workspacePath, t);
    onPresentationChange({ title: header.pathLabel, accessibleLabel: header.accessibleLabel,
      detail: header.overflowDetail, iconKey: session.launcherId, status: session.status,
      running: session.status === "running", resourceId: session.id });
  }, [onPresentationChange, session, t, workspacePath]);
  useEffect(() => { if (focusRequest && presentation.presented) entry.runtime.focus(); }, [entry, focusRequest, presentation.presented]);
  return <>
    <TerminalSessionView runtime={entry.runtime} workspacePath={workspacePath}
      presented={presentation.presented} focused={presentation.commandTarget} />
    {session.launchError && <div className="desktop-terminal-drop-error" role="alert">{session.launchError}</div>}
  </>;
}

function TerminalStatus({ entry }: { entry: TerminalRuntimeEntry }) {
  const session = useTerminalSession(entry);
  return <TerminalSessionHeaderStatus className="desktop-terminal-tab-status" runtime={entry.runtime} session={session} />;
}
