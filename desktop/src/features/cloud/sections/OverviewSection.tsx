import { Cloud, ExternalLink, RefreshCw } from "lucide-react";
import type { Workspace } from "@puppyone/shared-ui";
import type {
  DesktopCloudConnector,
  DesktopCloudDashboard,
  DesktopCloudHistory,
  DesktopCloudMcpEndpoint,
  DesktopCloudProject,
  DesktopCloudRepoIdentity,
  DesktopCloudScope,
  DesktopCloudTree,
  DesktopCloudTreeEntry,
} from "../../../lib/cloudApi";
import {
  ProjectFolderCard,
  type ProjectFolderPreviewItem,
} from "../../../components/project-folder-card";
import type { getPuppyoneRemote } from "../../source-control/remotes";
import type { CloudWorkspaceSection } from "../types";
import {
  CloudFilePreviewIcon,
  CloudWorkspaceLoadingState,
} from "../components/shared";
import {
  formatCloudDate,
  formatInteger,
  formatProviderLabel,
  formatRelativeTime,
  getCloudProviderIconUrl,
  isCloudIntegrationConnector,
} from "../utils";

export function CloudMappedOverview({
  workspace,
  project,
  dashboard,
  tree,
  history,
  scopes,
  connectors,
  mcpEndpoints,
  identity,
  cloudRemote,
  loading,
  onSelectSection,
  onOpenProject,
  onRefresh,
}: {
  workspace: Workspace;
  project: DesktopCloudProject | null;
  dashboard: DesktopCloudDashboard | null;
  tree: DesktopCloudTree | null;
  history: DesktopCloudHistory | null;
  scopes: DesktopCloudScope[];
  connectors: DesktopCloudConnector[];
  mcpEndpoints: DesktopCloudMcpEndpoint[];
  identity: DesktopCloudRepoIdentity | null;
  cloudRemote: ReturnType<typeof getPuppyoneRemote>;
  loading: boolean;
  onSelectSection: (section: CloudWorkspaceSection) => void;
  onOpenProject: (projectId: string, section?: CloudWorkspaceSection) => void;
  onRefresh: () => Promise<void>;
}) {
  const projectId = project?.id ?? dashboard?.project.id ?? identity?.project_id ?? "";
  const projectName = project?.name ?? dashboard?.project.name ?? workspace.name;
  const rootEntries = tree?.entries ?? [];
  const latestCommit = getLatestCloudHistoryCommit(history);
  const accessCount = scopes.length + mcpEndpoints.length;
  const accessDetail = formatAccessSummary(scopes.length, mcpEndpoints.length);
  const integrationConnectors = connectors.filter(isCloudIntegrationConnector);
  const latestChangeLabel = latestCommit?.created_at
    ? formatRelativeTime(latestCommit.created_at)
    : history?.head_commit_id
      ? "Synced"
      : "No changes";
  const latestChangeDate = latestCommit?.created_at
    ? formatCloudDate(latestCommit.created_at)
    : history?.head_commit_id
      ? "Synced"
      : "No changes";
  const hasOverviewData = Boolean(dashboard || tree || history || identity);
  const localMapped = Boolean(cloudRemote);
  const localMappingValue = localMapped ? workspace.path : identity?.url ?? "";

  if (loading && !hasOverviewData) {
    return <CloudWorkspaceLoadingState label="Loading Cloud project" />;
  }

  return (
    <section className="desktop-cloud-overview-focus" aria-label="Cloud project overview">
      <div className="desktop-cloud-overview-header">
        <div className="desktop-cloud-overview-heading">
          <div className="desktop-cloud-overview-title-row">
            <h1>{projectName}</h1>
            <span className="desktop-cloud-source-pill">
              <Cloud size={13} />
              <span>Cloud source</span>
            </span>
          </div>
          {project?.description || dashboard?.project.description ? (
            <p>{project?.description ?? dashboard?.project.description}</p>
          ) : null}
          {projectId && (
            <code className="desktop-cloud-project-id" title={projectId}>
              Project ID {projectId}
            </code>
          )}
        </div>
        <div className="desktop-cloud-repo-actions">
          <button className="desktop-cloud-row-action" type="button" onClick={() => void onRefresh()}>
            <RefreshCw size={13} className={loading ? "spin" : undefined} />
            <span>Refresh</span>
          </button>
          {projectId && (
            <button className="desktop-cloud-row-action" type="button" onClick={() => onOpenProject(projectId, "overview")}>
              <ExternalLink size={13} />
              <span>Open Web</span>
            </button>
          )}
        </div>
      </div>

      <div className="desktop-cloud-overview-body">
        <div className="desktop-cloud-overview-preview">
          <CloudProjectFolderPreview
            projectName={projectName}
            entries={rootEntries}
            loading={loading}
            updatedLabel={latestChangeLabel}
            statusConnected={localMapped}
            onSelect={() => onSelectSection("contents")}
          />
        </div>

        <div className="desktop-cloud-overview-side">
          <div className="desktop-cloud-overview-doc">
            <CloudOverviewMetricCard
              label="Last change"
              value={latestChangeDate}
              variant="date"
            />
            <CloudOverviewMetricCard
              label="Access"
              value={formatInteger(accessCount)}
              detail={accessDetail}
              tone={accessCount > 0 ? "ready" : undefined}
            />
            <CloudIntegrationsCard connectors={integrationConnectors} />
          </div>

          <CloudLocalMappingPanel
            mapped={localMapped}
            value={localMappingValue}
          />
        </div>
      </div>
    </section>
  );
}

export function CloudLocalMappingPanel({
  mapped,
  value,
}: {
  mapped: boolean;
  value: string;
}) {
  return (
    <div className={`desktop-cloud-local-map ${mapped ? "mapped" : "unmapped"}`}>
      <div className="desktop-cloud-local-map-main">
        <span>{mapped ? "Local mapping" : "Cloud URL"}</span>
        <code title={value}>{value || "Not linked locally"}</code>
      </div>
    </div>
  );
}

export function CloudOverviewMetricCard({
  label,
  value,
  detail,
  tone,
  mono,
  variant,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "ready" | "warning";
  mono?: boolean;
  variant?: "date";
}) {
  return (
    <div className={`desktop-cloud-overview-metric ${tone ?? ""} ${mono ? "mono" : ""} ${variant ?? ""}`}>
      <span className="desktop-cloud-overview-metric-label">{label}</span>
      <div className="desktop-cloud-overview-metric-value">
        <strong title={value}>{value}</strong>
        {detail ? <small title={detail}>{detail}</small> : null}
      </div>
    </div>
  );
}

export function CloudIntegrationsCard({
  connectors,
}: {
  connectors: DesktopCloudConnector[];
}) {
  return (
    <div className="desktop-cloud-integrations-card">
      <div className="desktop-cloud-integrations-heading">
        <span>Integrations</span>
      </div>
      <div className="desktop-cloud-integrations-value">
        {connectors.length > 0 ? (
          <>
            <span className="desktop-cloud-integrations-icons" aria-label={`${connectors.length} integrations`}>
              {connectors.map((connector) => (
                <CloudProviderTile key={connector.id} provider={connector.provider} />
              ))}
            </span>
            <small>{formatInteger(connectors.length)} connected</small>
          </>
        ) : (
          <>
            <strong>0</strong>
            <small>connected</small>
          </>
        )}
      </div>
    </div>
  );
}

export function CloudProviderTile({
  provider,
}: {
  provider: string;
}) {
  const iconUrl = getCloudProviderIconUrl(provider);
  const label = formatProviderLabel(provider);
  const fallback = label[0]?.toUpperCase() || "I";

  return (
    <span className="desktop-cloud-provider-tile" aria-hidden="true">
      {iconUrl ? <img src={iconUrl} alt="" draggable={false} /> : <span>{fallback}</span>}
    </span>
  );
}

export function CloudProjectFolderPreview({
  projectName,
  entries,
  loading,
  updatedLabel,
  statusConnected,
  onSelect,
}: {
  projectName: string;
  entries: DesktopCloudTreeEntry[];
  loading: boolean;
  updatedLabel: string;
  statusConnected: boolean;
  onSelect: () => void;
}) {
  const previewItems: ProjectFolderPreviewItem[] = entries.slice(0, 8).map((entry) => ({
    id: entry.path || entry.name,
    name: entry.name || entry.path,
    icon: (
      <CloudFilePreviewIcon
        name={entry.name || entry.path}
        type={entry.type}
        size={28}
        childrenCount={entry.children_count ?? undefined}
      />
    ),
  }));

  return (
    <ProjectFolderCard
      title={projectName}
      badge={null}
      previewItems={previewItems}
      previewLoading={loading}
      emptyLabel="Empty source"
      footer={{
        statusConnected,
        updatedLabel,
      }}
      onSelect={onSelect}
    />
  );
}

export function getLatestCloudHistoryCommit(history: DesktopCloudHistory | null): DesktopCloudHistory["commits"][number] | null {
  const commits = history?.commits ?? [];
  return commits.length > 0 ? commits[commits.length - 1] : null;
}

function formatAccessSummary(scopeCount: number, endpointCount: number) {
  if (endpointCount <= 0) return scopeCount === 1 ? "scope" : "scopes";
  const scopesLabel = `${formatInteger(scopeCount)} scope${scopeCount === 1 ? "" : "s"}`;
  const endpointsLabel = `${formatInteger(endpointCount)} endpoint${endpointCount === 1 ? "" : "s"}`;
  return `${scopesLabel} · ${endpointsLabel}`;
}
