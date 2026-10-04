import { lazy, Suspense } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { DesktopDialogCloseButton, DesktopDialogRoot, DesktopDialogSurface } from "../../../components/DesktopDialog";
import { PageLoading } from "../../../components/loading";
import { DesktopOverlayLayer } from "../../app-shell/DesktopOverlayPortal";
import type { ProjectCloudContext } from "../project/context";
import { CloudAutomationRouteSection } from "../sections/AutomationRouteSection";
import { CloudSurfaceFrame } from "../shell/CloudSurfaceFrame";
import "./workspace-tools.css";

const CloudMcpWorkspaceTool = lazy(() => import("./CloudMcpWorkspaceTool").then(module => ({ default: module.CloudMcpWorkspaceTool })));
export type CloudWorkspaceTool = "automation" | "mcp";

export function CloudWorkspaceToolDialog({ tool, context, session, apiBaseUrl, onSessionChange, onClose }: {
  tool: CloudWorkspaceTool;
  context: Extract<ProjectCloudContext, { status: "resolved" }>;
  session: DesktopCloudSession;
  apiBaseUrl: string;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const title = t(tool === "automation" ? "cloud.workspaceTools.automations" : "cloud.workspaceTools.mcp");
  return <DesktopOverlayLayer>
    <DesktopDialogRoot className="desktop-dialog-backdrop" onClose={onClose}>
      <DesktopDialogSurface className="desktop-cloud-dialog desktop-cloud-workspace-tool-dialog"
        width="min(960px, calc(100vw - 32px))" ariaLabel={title}>
        <header className="desktop-dialog-header desktop-cloud-dialog-header">
          <div className="desktop-dialog-title-row"><h2>{title}</h2></div>
          <DesktopDialogCloseButton label={t("common.action.close")} onClick={onClose} />
        </header>
        <div className="desktop-cloud-workspace-tool-content" data-cloud-workspace-tool-page={tool} data-cloud-project-id={context.projectId}>
          <CloudSurfaceFrame surface={tool === "automation" ? "automation" : "landing"}>
            {tool === "automation" ? <CloudAutomationRouteSection projectId={context.projectId}
              cloudSession={session} onSessionChange={onSessionChange} /> : <Suspense fallback={<PageLoading variant="fill" label={t("cloud.common.loading")} />}>
              <CloudMcpWorkspaceTool context={context} session={session} apiBaseUrl={apiBaseUrl} onSessionChange={onSessionChange} />
            </Suspense>}
          </CloudSurfaceFrame>
        </div>
      </DesktopDialogSurface>
    </DesktopDialogRoot>
  </DesktopOverlayLayer>;
}
