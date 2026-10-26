import { useMemo } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type { AuxiliaryWorkbenchContribution } from "../../../lib/workbench/types";
import { CloudAgentConversation } from "./CloudAgentConversation";
import { CloudAgentHistory } from "./CloudAgentHistory";
import { CloudAgentLauncher } from "./CloudAgentLauncher";
import { CLOUD_AGENT_KIND, CLOUD_AGENT_LABEL, type CloudAgentWorkbench } from "./CloudAgentWorkbench";
import type { CloudAgentSession } from "./cloudAgentClient";
import type { WorkbenchPanelComponent } from "../../../lib/workbench/panelContract";

/** Cloud is a contribution to the native workbench, not a second sidebar design. */
/** `Panel` is the shell's workbench panel, supplied by the composition root. */
export function CloudAgentSidebar({ workbench, active, Panel }: {
  workbench: CloudAgentWorkbench;
  active: boolean;
  Panel: WorkbenchPanelComponent;
}) {
  const { t } = useLocalization();
  const contributions = useMemo<readonly AuxiliaryWorkbenchContribution[]>(() => [{
    kind: CLOUD_AGENT_KIND, label: CLOUD_AGENT_LABEL, createLabel: t("agent.header.newChat"),
    initialSnapshot: { title: CLOUD_AGENT_LABEL, accessibleLabel: CLOUD_AGENT_LABEL, detail: null,
      iconKey: "puppyone-agent", status: "idle", running: false, resourceId: null },
    minimumSize: { width: 280, height: 260 },
    creationRecipes: [{ id: "cloud-pi", label: CLOUD_AGENT_LABEL, iconKey: "puppyone-agent", status: "available", availability: "bundled" }],
    history: { label: t("agent.history.title"), iconKey: "history",
      renderBrowser: context => <CloudAgentHistory workbench={workbench} {...context} /> },
    prepare: async ({ item, historyTarget }) => { workbench.prepare(item.id, historyTarget?.payload as CloudAgentSession | undefined); },
    discardPreparedItem: ({ item }) => { workbench.release(item.id); },
    renderItem: ({ item, presentation, focusRequest }) => <CloudAgentConversation controller={workbench.controller(item.id)!}
      active={presentation.presented && presentation.commandTarget} focusRequest={focusRequest} />,
    close: {
      decide: ({ item }) => workbench.canClose(item.id) ? { kind: "close" } : { kind: "blocked", dialog: {
        title: t("cloud.agent.pendingTitle"), detail: t("cloud.agent.pendingDetail"), actionLabel: t("agent.closeDialog.keepOpen"),
      } },
      commit: ({ item }) => workbench.release(item.id),
    },
  }], [workbench, t]);
  return <Panel store={workbench.store} contributions={contributions} active={active}
    renderLauncher={context => <CloudAgentLauncher workbench={workbench} contribution={contributions[0]} {...context} />} />;
}
