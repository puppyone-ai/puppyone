import { useSyncExternalStore } from "react";
import type { MessageFormatter } from "@puppyone/localization/core";
import type { AuxiliaryWorkbenchContribution, AuxiliaryWorkbenchItemRenderContext, AuxiliaryWorkbenchProject } from "../../app-shell/auxiliary-workbench/types";
import { DESKTOP_TERMINAL_LAUNCHERS } from "../model/terminalLaunchers";
import { HostedItemView } from "../../app-shell/auxiliary-workbench/host/HostedItemView";
import { projectItemHosts } from "../../app-shell/auxiliary-workbench/host/HostedItemPool";
import { TerminalSessionHeaderStatus } from "../ui/session-header/TerminalSessionHeaderStatus";
import { getTerminalClosePolicy } from "../model/terminalClosePolicy";
import { terminalLeafMinimumSize } from "../model/terminalSplitConstraints";
import type { TerminalAppearance } from "../runtime/terminalAppearance";
import "../ui/desktop-terminal.css";


function requirePool(project: AuxiliaryWorkbenchProject | undefined) {
  if (!project) throw new Error("Terminal requires an open project context.");
  return projectItemHosts(project);
}

export function createTerminalWorkbenchContribution(t: MessageFormatter, readAppearance: () => TerminalAppearance): AuxiliaryWorkbenchContribution {
  return {
    kind: "terminal", label: t("terminal.title"), createLabel: t("terminal.new"), minimumSize: terminalLeafMinimumSize(null), maximumItems: 32,
    initialSnapshot: { title: t("terminal.title"), accessibleLabel: t("terminal.title"), detail: null, iconKey: null, status: "starting", running: false, resourceId: null },
    getMinimumSize: ({ project, item }) => terminalLeafMinimumSize(requirePool(project).get(item.id)?.minimumSize),
    creationRecipes: DESKTOP_TERMINAL_LAUNCHERS.map((launcher) => ({ id: launcher.id, label: t(launcher.nameMessage), iconKey: launcher.id, status: "available" })),
    prepare: async ({ project, item, recipe }) => {
      const launcher = DESKTOP_TERMINAL_LAUNCHERS.find((entry) => entry.id === recipe?.id);
      if (!launcher) throw new Error("Unknown terminal launcher.");
      const appearance = readAppearance();
      await requirePool(project).prepare(item.id, "terminal", { recipeId: launcher.id, settings: { terminalAppearance: appearance, defaultColors: appearance.defaultColors } });
    },
    discardPreparedItem: async ({ project, item }) => { if (!project?.disposed) await requirePool(project).close(item.id); },
    renderItem: (context) => <TerminalWorkbenchItem {...context} readAppearance={readAppearance} />,
    renderStatus: ({ project, item }) => {
      if (project?.disposed) return null;
      const entry = requirePool(project).get(item.id);
      return entry ? <HostedTerminalStatus entry={entry} /> : null;
    },
    close: {
      decide: ({ snapshot }) => getTerminalClosePolicy(snapshot.status === "idle" ? "exited" : snapshot.status) === "close" ? { kind: "close" } : {
        kind: "confirm", tone: "danger", dialog: { title: t("terminal.closeDialog.title", { title: snapshot.title }), detail: t("terminal.closeDialog.detail"), actionLabel: t("terminal.closeDialog.confirm") },
      },
      commit: ({ project, item }) => requirePool(project).close(item.id),
    },
  };
}

function TerminalWorkbenchItem({ readAppearance, ...context }: AuxiliaryWorkbenchItemRenderContext & { readAppearance: () => TerminalAppearance }) {
  return <HostedItemView {...context} settings={{ terminalAppearance: readAppearance() }} />;
}

function HostedTerminalStatus({ entry }: { entry: NonNullable<ReturnType<ReturnType<typeof projectItemHosts>["get"]>> }) {
  useSyncExternalStore(entry.subscribe, entry.getSnapshot);
  const launcherId = DESKTOP_TERMINAL_LAUNCHERS.find((launcher) => launcher.id === entry.summary?.iconKey)?.id ?? null;
  const status = entry.summary?.status;
  return <TerminalSessionHeaderStatus className="desktop-terminal-tab-status" runtime={entry}
    session={{ id: entry.identity.itemId, ordinal: 1, shell: null, launcherId,
      status: status === "running" || status === "exited" || status === "error" ? status : "starting" }} />;
}
