import { lazy, Suspense } from "react";
import { PageLoading } from "../../../components/loading";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { CloudAgentSidebarHost } from "../agent/lazy";
import type { useCloudAgentWorkspace } from "../agent/useCloudAgentWorkspace";
import type { ProjectCloudContext } from "../project/context";
import type { CloudWorkspaceSidebarController } from "./useCloudWorkspaceSidebar";
import type { WorkbenchPanelComponent } from "../../../lib/workbench/panelContract";

const HistorySidebar = lazy(() => import("../history/CloudWorkspaceHistorySidebar").then(module => ({ default: module.CloudWorkspaceHistorySidebar })));

export function CloudWorkspaceSidebar({ sidebar, agent, context, session, apiBaseUrl, active, revisionKey, onSessionChange, workbenchPanel }: {
  sidebar: CloudWorkspaceSidebarController;
  /** The shell's workbench panel; the Cloud agent contributes to it without importing the shell. */
  workbenchPanel: WorkbenchPanelComponent;
  agent: ReturnType<typeof useCloudAgentWorkspace>;
  context: ProjectCloudContext | null;
  session: DesktopCloudSession | null;
  apiBaseUrl: string;
  active: boolean;
  title: string;
  revisionKey: string;
  onSessionChange: (session: DesktopCloudSession | null) => void;
}) {
  if (!sidebar.scope) return null;
  if (sidebar.historyOpen && context?.status === "resolved") return <Suspense fallback={<PageLoading variant="fill" />}>
    <HistorySidebar key={sidebar.scope} session={session} projectId={context.projectId} apiBaseUrl={apiBaseUrl}
      active={active} revisionKey={revisionKey} onSessionChange={onSessionChange} onClose={sidebar.close} />
  </Suspense>;
  return <CloudAgentSidebarHost key={sidebar.scope} workbench={agent.workbench} open={agent.open} active={active} Panel={workbenchPanel} />;
}
