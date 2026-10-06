import { Tooltip } from "@puppyone/shared-ui";
import { lazy, Suspense } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { DesktopDialogCloseButton, DesktopDialogRoot, DesktopDialogSurface } from "../../../components/DesktopDialog";
import { PageLoading } from "../../../components/loading";
import { DesktopOverlayLayer } from "../../app-shell/DesktopOverlayPortal";
import type { ProjectCloudContext } from "../project/context";
import { CloudAutomationRouteSection } from "../sections/AutomationRouteSection";
import { CloudSurfaceFrame } from "../shell/CloudSurfaceFrame";
import { Grid2X2, Plug } from "lucide-react";
import "./workspace-tools.css";

const CloudConnectWorkspaceTool = lazy(() => import("./CloudConnectWorkspaceTool").then(module => ({ default: module.CloudConnectWorkspaceTool })));
export type CloudWorkspaceTool = "automation" | "connect";

export function CloudWorkspaceToolDialog({ tool, context, session, apiBaseUrl, onSessionChange, onClose }: {
  tool: CloudWorkspaceTool;
  context: Extract<ProjectCloudContext, { status: "resolved" }>;
  session: DesktopCloudSession;
  apiBaseUrl: string;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const title = t(tool === "automation" ? "cloud.workspaceTools.automations" : "cloud.workspaceTools.connect");
  return <DesktopOverlayLayer>
    <DesktopDialogRoot className="desktop-cloud-dialog-backdrop" onClose={onClose}>
      <DesktopDialogSurface className="desktop-cloud-dialog desktop-cloud-workspace-tool-dialog"
        width={960} ariaLabel={title}>
        <header className="desktop-dialog-header desktop-cloud-dialog-header">
          <div className="desktop-dialog-title-row desktop-cloud-dialog-title-row">
            <span className="desktop-cloud-dialog-leading" aria-hidden="true">{tool === "automation" ? <Grid2X2 size={15} /> : <Plug size={15} />}</span><h2>{title}</h2></div>
          <Tooltip content={t("common.action.close")}><DesktopDialogCloseButton label={t("common.action.close")} onClick={onClose} /></Tooltip>
        </header>
        <div className="desktop-cloud-workspace-tool-content" data-cloud-workspace-tool-page={tool} data-cloud-project-id={context.projectId}>
          <CloudSurfaceFrame surface={tool === "automation" ? "automation" : "landing"}>
            {tool === "automation" ? <CloudAutomationRouteSection projectId={context.projectId}
              cloudSession={session} onSessionChange={onSessionChange} /> : <Suspense fallback={<PageLoading variant="fill" label={t("cloud.common.loading")} />}>
              <CloudConnectWorkspaceTool context={context} session={session} apiBaseUrl={apiBaseUrl} onSessionChange={onSessionChange} />
            </Suspense>}
          </CloudSurfaceFrame>
        </div>
      </DesktopDialogSurface>
    </DesktopDialogRoot>
  </DesktopOverlayLayer>;
}
