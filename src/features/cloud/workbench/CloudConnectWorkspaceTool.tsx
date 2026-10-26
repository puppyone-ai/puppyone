import { useMemo, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context";
import { useDesktopCloudData } from "../data";
import { getCloudProjectDetailResources } from "../routes/cloudRoutes";
import { AccessPointRoutePage } from "../access-points/pages/AccessPointRoutePage";
import { SidebarRoot, SidebarRow, SidebarScrollArea } from "@puppyone/shared-ui";
import { Terminal, GitBranch } from "lucide-react";
import { McpLogoIcon } from "../components/McpLogoIcon";
import { CloudServiceUnavailable } from "../components/CloudServiceUnavailable";
import { PageLoading } from "../../../components/loading";

export function CloudConnectWorkspaceTool({ context, session, apiBaseUrl, onSessionChange }: {
  context: Extract<ProjectCloudContext, { status: "resolved" }>;
  session: DesktopCloudSession;
  apiBaseUrl: string;
  onSessionChange: (session: DesktopCloudSession | null) => void;
}) {
  const { t } = useLocalization();
  const [kind, setKind] = useState<"mcp" | "cli" | "git">("mcp");
  const environment = useMemo(() => ({ apiBaseUrl, source: "default" as const, cloudRemote: null }), [apiBaseUrl]);
  const data = useDesktopCloudData({ session, cloudEnvironment: environment, projectId: context.projectId,
    onSessionChange, projectDetailResources: getCloudProjectDetailResources("mcp") });
  let content;
  if (data.loading) content = <PageLoading variant="fill" label={t("cloud.common.loading")} />;
  else if (data.error || data.warning) content = <CloudServiceUnavailable title={t("cloud.workspaceTools.connect")}
    onRetry={() => void data.reload()} />;
  else content = <AccessPointRoutePage kind={kind} projectId={context.projectId} cloudSession={session}
    apiBaseUrl={apiBaseUrl} identity={data.identity} scopes={data.scopes} connectors={data.connectors}
    mcpEndpoints={data.mcpEndpoints} loading={false}
    canManage={data.project?.id === context.projectId
      && context.capabilities?.includes("access_surface.manage") === true
      && data.project.capabilities?.includes("access_surface.manage") === true}
    onCloudSessionChange={onSessionChange} onRefresh={data.reload} />;
  const methods = [
    { id: "mcp" as const, label: "MCP", icon: <McpLogoIcon size={15} /> },
    { id: "cli" as const, label: "CLI", icon: <Terminal size={15} /> },
    { id: "git" as const, label: "Git", icon: <GitBranch size={15} /> },
  ];
  return <div className="desktop-cloud-dialog-layout">
    <aside className="desktop-cloud-dialog-navigation">
      <SidebarRoot className="desktop-settings-sidebar" aria-label={t("cloud.workspaceTools.connect")}>
        <SidebarScrollArea>{methods.map(method => <SidebarRow key={method.id} active={kind === method.id}
          aria-current={kind === method.id ? "page" : undefined} data-cloud-connect-method={method.id}
          icon={method.icon} label={method.label} onClick={() => setKind(method.id)} />)}</SidebarScrollArea>
      </SidebarRoot>
    </aside>
    <div className="desktop-cloud-dialog-content desktop-cloud-connect-content">
      {content}
    </div>
  </div>;
}
