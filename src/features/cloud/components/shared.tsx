import { Check, ChevronRight, Cloud, Copy, ExternalLink, FileText, FolderOpen, GitBranch, RefreshCw } from "lucide-react";
import {
  Tooltip,
  FilePreviewIcon,
  RENDERER_ASSET_PATHS,
  resolveRendererPublicAssetUrl,
  type Workspace,
} from "@puppyone/shared-ui";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import "./shared.css";
import "./web-page.css";
import "./command-blocks.css";
import { useState, type ReactNode } from "react";
import type {
  DesktopCloudDashboard,
  DesktopCloudProject,
  DesktopCloudTreeEntry,
} from "../../../lib/cloudApi";
import type { DesktopCloudHistory } from "../../../lib/cloudHistoryApi";
import type { CloudWorkspaceSection } from "../types";
import { PageLoading } from "../../../components/loading";
import {
  copyText,
  formatCloudTreeEntryDetail,
  formatCommitChangeCount,
  formatRelativeTime,
  formatStatusLabel,
  normalizeCloudEntryPath,
  shortCommit,
} from "../utils";

type CloudEmptyStateIcon = (props: { size?: number; className?: string }) => ReactNode;

export function CloudWorkspaceLoadingState({ label }: { label?: string }) {
  const { t } = useLocalization();
  const resolvedLabel = label ?? t("cloud.common.loading");
  return (
    <div className="desktop-cloud-loading-state" role="status" aria-label={resolvedLabel}>
      <PageLoading
        variant="fill"
        label={resolvedLabel}
      />
    </div>
  );
}

export function CloudMainSection({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: string | number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="desktop-cloud-section-card">
      <div className="desktop-cloud-section-card-header">
        <div>
          <span>{title}</span>
          {count !== undefined && <small>{count}</small>}
        </div>
        {action}
      </div>
      <div className="desktop-cloud-section-card-body">
        {children}
      </div>
    </section>
  );
}

export function CloudMainMetric({
  label,
  value,
  tone,
  mono,
}: {
  label: string;
  value: string;
  tone?: "ready" | "warning";
  mono?: boolean;
}) {
  return (
    <div className={`desktop-cloud-main-metric ${tone ?? ""} ${mono ? "mono" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function CloudAuthorityCell({
  label,
  value,
  title,
  tone,
  mono,
}: {
  label: string;
  value: string;
  title?: string;
  tone?: "ready" | "warning";
  mono?: boolean;
}) {
  return (
    <div className={`desktop-cloud-authority-cell ${tone ?? ""} ${mono ? "mono" : ""}`}>
      <span>{label}</span>
      <Tooltip content={title ?? value}><strong>{value}</strong></Tooltip>
    </div>
  );
}

export function CloudAssetGrid({
  entries,
  emptyLabel,
  emptyDetail,
  loading = false,
  onEntryClick,
}: {
  entries: DesktopCloudTreeEntry[];
  emptyLabel: string;
  emptyDetail: string;
  loading?: boolean;
  onEntryClick: (entry: DesktopCloudTreeEntry) => void;
}) {
  const localization = useLocalization();
  if (loading) {
    return <PageLoading variant="fill" label={localization.t("cloud.common.loading")} className="desktop-cloud-asset-loading" />;
  }

  if (entries.length === 0) {
    return <CloudInlineEmpty icon={FolderOpen} title={emptyLabel} detail={emptyDetail} />;
  }

  return (
    <div className="desktop-cloud-asset-grid">
      {entries.map((entry) => (
        <Tooltip content={entry.path || entry.name} key={entry.path || entry.name}><button
          className="desktop-cloud-asset-tile"
          type="button"
          onClick={() => onEntryClick(entry)}
                                                                                   >
          <span className="desktop-cloud-asset-icon">
            <CloudFilePreviewIcon
              name={entry.name || entry.path}
              type={entry.type}
              size={44}
              childrenCount={entry.children_count ?? undefined}
            />
          </span>
          <strong>{entry.name || entry.path}</strong>
          <small>{formatCloudTreeEntryDetail(entry, localization)}</small>
        </button></Tooltip>
      ))}
    </div>
  );
}

export function CloudFilePreviewIcon({
  name,
  type,
  size,
  childrenCount,
}: {
  name: string;
  type?: string | null;
  size: number;
  childrenCount?: number | null;
}) {
  if (type === "folder") {
    return (
      <span
        className="desktop-cloud-folder-icon"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <img
          src={resolveRendererPublicAssetUrl(RENDERER_ASSET_PATHS.icons.ui.folder)}
          alt=""
          width={size}
          height={size}
        />
        {childrenCount != null && childrenCount > 0 && (
          <em>{childrenCount}</em>
        )}
      </span>
    );
  }

  return <FilePreviewIcon name={name} type={type} size={size} childrenCount={childrenCount} />;
}

export function CloudPathBreadcrumb({
  path,
  onSelectPath,
}: {
  path: string;
  onSelectPath: (path: string) => void;
}) {
  const { t } = useLocalization();
  const parts = normalizeCloudEntryPath(path).split("/").filter(Boolean);
  const crumbs = [
    { label: t("cloud.common.cloudSource"), path: "" },
    ...parts.map((part, index) => ({
      label: part,
      path: parts.slice(0, index + 1).join("/"),
    })),
  ];

  return (
    <div className="desktop-cloud-path-breadcrumb" aria-label={t("cloud.path.ariaLabel")}>
      {crumbs.map((crumb, index) => (
        <button
          key={crumb.path || "root"}
          type="button"
          className={index === crumbs.length - 1 ? "active" : ""}
          onClick={() => onSelectPath(crumb.path)}
        >
          {index > 0 && <ChevronRight className="desktop-cloud-directional-icon" size={12} />}
          <span dir="auto">{crumb.label}</span>
        </button>
      ))}
    </div>
  );
}

export function CloudWebPage({
  title,
  count,
  action,
  children,
  className,
}: {
  title: string;
  count?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useLocalization();
  return (
    <section className={`desktop-cloud-web-page ${className ?? ""}`}>
      <div className="desktop-cloud-web-header">
        <div>
          <span>{title}</span>
          {count !== undefined && <small>{count}</small>}
        </div>
        {action}
      </div>
      <div className="desktop-cloud-web-body">
        {children}
      </div>
    </section>
  );
}

export function CloudSectionLabel({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="desktop-cloud-section-label">
      <span>{children}</span>
      {right}
    </div>
  );
}

export function CloudWebEmpty({
  icon: Icon,
  title,
  detail,
}: {
  icon: CloudEmptyStateIcon;
  title: string;
  detail: string;
}) {
  return (
    <div className="desktop-cloud-web-empty">
      <span><Icon size={18} /></span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

export function CloudSourceDock({
  remote,
  branch,
  tooltip,
}: {
  remote: string;
  branch: string;
  tooltip?: string;
}) {
  const { t } = useLocalization();
  return (
    <Tooltip content={tooltip}><div className="desktop-cloud-source-dock">
      <span className="desktop-cloud-web-status-dot ready" aria-hidden="true" />
      <strong>{t("cloud.common.cloudSource")}</strong>
      <em dir="auto">{remote}</em>
      <em dir="auto">{branch}</em>
    </div></Tooltip>
  );
}

export function CloudPromptBlock({ value }: { value: string }) {
  const { t } = useLocalization();
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await copyText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="desktop-cloud-prompt-block">
      <pre data-po-scrollbar="content">{value}</pre>
      <button type="button" onClick={handleCopy}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
        <span>{copied ? t("cloud.common.copied") : t("cloud.common.copyPrompt")}</span>
      </button>
    </div>
  );
}

export function CloudCommandBlock({
  label,
  value,
  disabled,
}: {
  label: string;
  value: string;
  disabled?: boolean;
}) {
  const { t } = useLocalization();
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (disabled) return;
    await copyText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="desktop-cloud-command-block">
      <div>
        <span>{label}</span>
        <button type="button" disabled={disabled} aria-label={t("cloud.common.copyValue", { label })} onClick={handleCopy}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre>{value}</pre>
    </div>
  );
}

export function CloudProjectRow({
  project,
  action,
  onOpenProject,
  onConnectProject,
  onCopyCloneCommand,
}: {
  project: DesktopCloudProject;
  action: { kind: "backup" | "connect" | "copy" | null; projectId: string | null };
  onOpenProject: (projectId: string, section?: CloudWorkspaceSection) => void;
  onConnectProject: (project: DesktopCloudProject) => void;
  onCopyCloneCommand: (project: DesktopCloudProject) => void;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const busy = action.projectId === project.id ? action.kind : null;
  return (
    <div className="desktop-cloud-project-row">
      <span><Cloud size={15} /></span>
      <div>
        <Tooltip content={project.name} overflowOnly><strong dir="auto">{project.name}</strong></Tooltip>
        <small dir={project.description ? "auto" : undefined}>{project.description || t("cloud.project.updated", {
          time: bidiIsolate(project.updated_at ? formatRelativeTime(project.updated_at, localization) : t("cloud.time.recently")),
        })}</small>
      </div>
      <div className="desktop-cloud-project-row-actions">
        <button type="button" onClick={() => onOpenProject(project.id, "access")}>{t("cloud.common.open")}</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => onConnectProject(project)}>
          {t(busy === "connect" ? "cloud.project.connecting" : "cloud.project.useHere")}
        </button>
        <button type="button" disabled={Boolean(busy)} onClick={() => onCopyCloneCommand(project)}>
          {t(busy === "copy" ? "cloud.common.copying" : "cloud.project.cloneCommand")}
        </button>
      </div>
    </div>
  );
}

export function CloudInlineEmpty({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof Cloud;
  title: string;
  detail: string;
}) {
  return (
    <div className="desktop-cloud-inline-empty">
      <span><Icon size={15} /></span>
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}
