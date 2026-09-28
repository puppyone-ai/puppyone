import { Tooltip } from "@puppyone/shared-ui";
import { RefreshCw } from "lucide-react";
import type { Workspace } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import "./overview.css";
import type {
  DesktopCloudConnector,
  DesktopCloudDashboard,
  DesktopCloudMcpEndpoint,
  DesktopCloudProject,
  DesktopCloudRepoIdentity,
  DesktopCloudScope,
  DesktopCloudTree,
} from "../../../../lib/cloudApi";
import type { DesktopCloudHistory } from "../../../../lib/cloudHistoryApi";
import { getCloudRoute } from "../../routes/cloudRoutes";
import type { ProjectCloudContext } from "../../project/context/projectCloudContext";
import { projectRootTarget } from "../../repositoryTarget";
import { CloudShareHome, useCloudShare } from "../../share";
import type { CloudWorkspaceSection } from "../../types";
import {
  formatBytes,
  formatFullTime,
  formatRelativeTime,
} from "../../utils";
import { CloudOverviewActions } from "./OverviewActions";
import { CloudOverviewDashboard } from "./OverviewDashboard";
import {
  getCloudOverviewMetrics,
  getCloudOverviewStorageUsage,
  getLatestCloudUpdateAt,
  type CloudOverviewStorageUsage,
} from "./overviewMetrics";

/**
 * `home` is the Cloud Homepage; `project` is the identity/data view the Share
 * experiment demotes to a second sidebar entry. Without the experiment both
 * render the classic overview.
 */
export type CloudRepositoryOverviewVariant = "home" | "project";

export function CloudRepositoryOverview({
  variant = "home",
  projectContext,
  workspace,
  project,
  dashboard,
  tree,
  history,
  scopes,
  connectors,
  mcpEndpoints,
  identity,
  loading,
  onSelectSection,
  onRefresh,
}: {
  variant?: CloudRepositoryOverviewVariant;
  /** Needed for the Share-first Homepage status; the classic layout ignores it. */
  projectContext?: ProjectCloudContext;
  workspace: Workspace;
  project: DesktopCloudProject | null;
  dashboard: DesktopCloudDashboard | null;
  tree: DesktopCloudTree | null;
  history: DesktopCloudHistory | null;
  scopes: DesktopCloudScope[];
  connectors: DesktopCloudConnector[];
  mcpEndpoints: DesktopCloudMcpEndpoint[];
  identity: DesktopCloudRepoIdentity | null;
  loading: boolean;
  onSelectSection: (section: CloudWorkspaceSection) => void;
  onRefresh: () => Promise<void>;
}) {
  const localization = useLocalization();
  const { formatNumber, t } = localization;
  const share = useCloudShare();
  const shareHomeContext = share !== null && variant === "home"
    ? projectContext ?? resolvedContextFor(project?.id ?? null)
    : null;
  const projectName = project?.name ?? workspace.name;
  const overviewMetrics = getCloudOverviewMetrics({
    scopes,
    connectors,
    mcpEndpoints,
    identity,
  });
  const storageUsage = getCloudOverviewStorageUsage(dashboard, tree);
  const latestUpdateAt = getLatestCloudUpdateAt(project?.updated_at ?? null, history);
  const latestUpdate = latestUpdateAt
    ? formatRelativeTime(latestUpdateAt, localization)
    : "—";
  const SettingsIcon = getCloudRoute("settings").icon;
  const hasOverviewData = Boolean(
    dashboard
    || tree
    || history
    || identity
    || scopes.length > 0
    || connectors.length > 0
    || mcpEndpoints.length > 0,
  );
  const initialLoading = loading && !hasOverviewData;
  const headerActions = (
    <div className="desktop-cloud-overview-header-actions">
      {project?.capabilities?.includes("project.settings.manage") === true && (
        <Tooltip content={t("cloud.route.settings.title")}><button
          className="desktop-cloud-overview-settings-button"
          type="button"
          aria-label={t("cloud.route.settings.title")}
          onClick={() => onSelectSection("settings")}
        >
          <SettingsIcon size={13} />
        </button></Tooltip>
      )}
      <Tooltip content={t("cloud.common.refresh")}><button
        className="desktop-cloud-overview-refresh-button"
        type="button"
        aria-label={t("cloud.common.refresh")}
        onClick={() => void onRefresh()}
      >
        <RefreshCw size={13} className={loading ? "animate-spin" : undefined} />
      </button></Tooltip>
    </div>
  );

  if (share && shareHomeContext) {
    const fileCount = dashboard?.nodes.files ?? null;
    const storage = storageUsage.bytes === null
      ? null
      : `${formatBytes(storageUsage.bytes, localization)}${storageUsage.isLowerBound ? "+" : ""}`;
    const summaryParts = [
      fileCount === null ? null : t("cloud.history.fileCount", { count: fileCount }),
      storage,
    ].filter((part): part is string => Boolean(part));
    return (
      <section className="desktop-cloud-overview-page" aria-label={t("cloud.overview.ariaLabel")}>
        <main className="desktop-cloud-overview-canvas" data-po-scrollbar="content">
          <div className="desktop-cloud-overview-catalog desktop-share-home-catalog">
            <div className="desktop-share-home-toolbar">{headerActions}</div>
            <CloudShareHome
              projectName={projectName}
              projectSummary={summaryParts.length > 0 ? summaryParts.join(" · ") : null}
              latestUpdateAt={latestUpdateAt}
              projectContext={shareHomeContext}
              share={share}
              onSelectSection={onSelectSection}
            />
          </div>
        </main>
      </section>
    );
  }

  return (
    <section className="desktop-cloud-overview-page" aria-label={t("cloud.overview.ariaLabel")}>
      <main className="desktop-cloud-overview-canvas" data-po-scrollbar="content">
        <div className="desktop-cloud-overview-catalog">
          <header className="desktop-cloud-overview-landing-header">
            <div className="desktop-cloud-overview-landing-copy">
              <div className="desktop-cloud-overview-title-row">
                <h1 dir="auto">{projectName}</h1>
                {headerActions}
              </div>
            </div>

            <CloudOverviewStorageMeter usage={storageUsage} loading={initialLoading} />

            <div className="desktop-cloud-overview-header-side">
              <div className="desktop-cloud-overview-header-facts">
                <CloudOverviewHeaderFact
                  label={t("cloud.overview.lastUpdated")}
                  value={latestUpdate}
                  valueTitle={latestUpdateAt
                    ? formatFullTime(latestUpdateAt, localization.formatDate)
                    : undefined}
                  ariaLabel={t("cloud.overview.viewHistory")}
                  loading={initialLoading}
                  onClick={() => onSelectSection("history")}
                />
                <CloudOverviewHeaderFact
                  label={t("cloud.overview.activeConnections")}
                  value={formatNumber(overviewMetrics.activeAccessPointCount)}
                  ariaLabel={t("cloud.overview.manageAccessPoints")}
                  loading={initialLoading}
                  onClick={() => onSelectSection("access")}
                />
              </div>
            </div>
          </header>

          {variant === "home" && <CloudOverviewActions onSelectSection={onSelectSection} />}

          <CloudOverviewDashboard
            history={history}
            dashboard={dashboard}
            tree={tree}
            loading={loading}
          />
        </div>
      </main>
    </section>
  );
}

function CloudOverviewHeaderFact({
  label,
  value,
  valueTitle,
  ariaLabel,
  loading,
  onClick,
}: {
  label: string;
  value: string;
  valueTitle?: string;
  ariaLabel: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="desktop-cloud-overview-header-fact desktop-cloud-overview-header-fact--interactive"
      type="button"
      aria-label={ariaLabel}
      aria-busy={loading}
      onClick={onClick}
    >
      <span className="desktop-cloud-overview-header-fact-label">{label}</span>
      <Tooltip content={valueTitle}><strong>
        {loading
          ? <span className="desktop-cloud-overview-value-skeleton" aria-hidden="true" />
          : value}
      </strong></Tooltip>
    </button>
  );
}

function CloudOverviewStorageMeter({
  usage,
  loading,
}: {
  usage: CloudOverviewStorageUsage;
  loading: boolean;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const pending = loading && usage.bytes === null;
  const used = usage.bytes === null
    ? loading ? t("cloud.common.loading") : "—"
    : `${formatBytes(usage.bytes, localization)}${usage.isLowerBound ? "+" : ""}`;
  const detail = usage.limitBytes === null
    ? used
    : `${used} ${t("cloud.billing.storageLimit", {
      limit: formatBytes(usage.limitBytes, localization),
    })}`;
  const progressProps = usage.percent === null
    ? { "aria-hidden": true as const }
    : {
        role: "progressbar" as const,
        "aria-label": t("cloud.billing.storageUsage"),
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        "aria-valuenow": Math.round(usage.percent),
        "aria-valuetext": detail,
      };

  return (
    <Tooltip content={pending ? t("cloud.common.loading") : detail}><div
      className={`desktop-cloud-overview-project-storage${pending ? " is-loading" : ""}`}
      aria-busy={pending}
    >
      <span className="desktop-cloud-overview-project-storage-track" {...progressProps}>
        {usage.percent !== null ? (
          <span style={{ width: `${usage.percent}%` }} />
        ) : null}
      </span>
    </div></Tooltip>
  );
}

/** The Homepage only renders once the Project resolved; synthesize that context when the caller has none. */
function resolvedContextFor(projectId: string | null): ProjectCloudContext {
  return projectId
    ? { status: "resolved", projectId, target: projectRootTarget(projectId) }
    : { status: "resolving", projectId: null };
}
