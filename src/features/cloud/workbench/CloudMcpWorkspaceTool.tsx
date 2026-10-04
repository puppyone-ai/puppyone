import { useMemo } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context";
import { useDesktopCloudData } from "../data";
import { getCloudProjectDetailResources } from "../routes/cloudRoutes";
import { AccessPointRoutePage } from "../access-points/pages/AccessPointRoutePage";
import { formatCloudMessage } from "../cloudPresentation";

export function CloudMcpWorkspaceTool({ context, session, apiBaseUrl, onSessionChange }: {
  context: Extract<ProjectCloudContext, { status: "resolved" }>;
  session: DesktopCloudSession;
  apiBaseUrl: string;
  onSessionChange: (session: DesktopCloudSession | null) => void;
}) {
  const { t } = useLocalization();
  const environment = useMemo(() => ({ apiBaseUrl, source: "default" as const, cloudRemote: null }), [apiBaseUrl]);
  const data = useDesktopCloudData({ session, cloudEnvironment: environment, projectId: context.projectId,
    onSessionChange, projectDetailResources: getCloudProjectDetailResources("mcp") });
  if (data.error) return <div role="alert" className="desktop-dialog-error">
    {formatCloudMessage(data.error, t)}
    <button type="button" onClick={() => void data.reload()}>{t("common.action.retry")}</button>
  </div>;
  return <>
    {data.warning && <div role="status" className="desktop-dialog-error">
      {formatCloudMessage(data.warning, t)}
      <button type="button" onClick={() => void data.reload()}>{t("common.action.retry")}</button>
    </div>}
    <AccessPointRoutePage kind="mcp" projectId={context.projectId} cloudSession={session}
    apiBaseUrl={apiBaseUrl} identity={data.identity} scopes={data.scopes} connectors={data.connectors}
    mcpEndpoints={data.mcpEndpoints} loading={data.loading}
    canManage={!data.loading && !data.warning && data.project?.id === context.projectId
      && context.capabilities?.includes("access_surface.manage") === true
      && data.project?.capabilities?.includes("access_surface.manage") === true}
    onCloudSessionChange={onSessionChange} onRefresh={data.reload} />
  </>;
}
