import { Check, ChevronRight, Cloud, Copy, ExternalLink, FileText, FolderOpen, GitBranch, RefreshCw, Server } from "lucide-react";
import { FilePreviewIcon, type Workspace } from "@puppyone/shared-ui";
import { useState, type ReactNode } from "react";
import type {
  DesktopCloudDashboard,
  DesktopCloudHistory,
  DesktopCloudMcpEndpoint,
  DesktopCloudProject,
  DesktopCloudTreeEntry,
} from "../../../lib/cloudApi";
import type { CloudWorkspaceSection } from "../types";
import { PageLoading } from "../../../components/loading";
import {
  copyText,
  formatCloudTreeEntryDetail,
  formatCommitChangeCount,
  formatRelativeTime,
  normalizeCloudEntryPath,
  shortCommit,
} from "../utils";

export function CloudWorkspaceLoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="desktop-cloud-loading-state" role="status" aria-label={label}>
      <PageLoading
        variant="fill"
        tone="info"
        label={label}
        style={{ width: "auto", height: "auto", minHeight: 0, gap: 8 }}
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
      <strong title={value}>{value}</strong>
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
      <strong title={title ?? value}>{value}</strong>
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
  if (loading) {
    return <PageLoading variant="fill" label="Loading" className="desktop-cloud-asset-loading" />;
  }

  if (entries.length === 0) {
    return <CloudInlineEmpty icon={FolderOpen} title={emptyLabel} detail={emptyDetail} />;
  }

  return (
    <div className="desktop-cloud-asset-grid">
      {entries.map((entry) => (
        <button
          className="desktop-cloud-asset-tile"
          key={entry.path || entry.name}
          type="button"
          title={entry.path || entry.name}
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
          <small>{formatCloudTreeEntryDetail(entry)}</small>
        </button>
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
        <img src="/icons/folder.svg" alt="" width={size} height={size} />
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
  const parts = normalizeCloudEntryPath(path).split("/").filter(Boolean);
  const crumbs = [
    { label: "Cloud source", path: "" },
    ...parts.map((part, index) => ({
      label: part,
      path: parts.slice(0, index + 1).join("/"),
    })),
  ];

  return (
    <div className="desktop-cloud-path-breadcrumb" aria-label="Cloud folder path">
      {crumbs.map((crumb, index) => (
        <button
          key={crumb.path || "root"}
          type="button"
          className={index === crumbs.length - 1 ? "active" : ""}
          onClick={() => onSelectPath(crumb.path)}
        >
          {index > 0 && <ChevronRight size={12} />}
          <span>{crumb.label}</span>
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
  icon: typeof Cloud;
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
  title,
}: {
  remote: string;
  branch: string;
  title?: string;
}) {
  return (
    <div className="desktop-cloud-source-dock" title={title}>
      <span className="desktop-cloud-web-status-dot ready" aria-hidden="true" />
      <strong>Cloud source</strong>
      <em>{remote}</em>
      <em>{branch}</em>
    </div>
  );
}

export function CloudPromptBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await copyText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="desktop-cloud-prompt-block">
      <pre>{value}</pre>
      <button type="button" onClick={handleCopy}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
        <span>{copied ? "Copied" : "Copy prompt"}</span>
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
        <button type="button" disabled={disabled} onClick={handleCopy}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre>{value}</pre>
    </div>
  );
}

export function CloudMethodSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="desktop-cloud-method-section">
      <CloudSectionLabel>{title}</CloudSectionLabel>
      {children}
    </section>
  );
}

export function CloudMethodCard({
  icon: Icon,
  subtitle,
  active,
  children,
}: {
  icon: typeof Cloud;
  subtitle: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`desktop-cloud-method-card ${active ? "active" : ""}`}>
      <div className="desktop-cloud-method-card-header">
        <span><Icon size={16} /></span>
        <strong>{subtitle}</strong>
        <em>{active ? "Active" : "Needs key"}</em>
      </div>
      {active && <div className="desktop-cloud-method-card-body">{children}</div>}
      {!active && <div className="desktop-cloud-method-card-body">{children}</div>}
    </div>
  );
}

export function CloudMcpEndpointCard({
  endpoint,
  apiBase,
  onOpen,
  compact = false,
}: {
  endpoint: DesktopCloudMcpEndpoint;
  apiBase: string;
  onOpen: () => void;
  compact?: boolean;
}) {
  const serverUrl = endpoint.api_key && apiBase ? `${apiBase}/api/v1/mcp/server/${endpoint.api_key}` : "";
  const accessLabel = endpoint.accesses?.length
    ? endpoint.accesses.map((access) => access.path || "/").join(", ")
    : endpoint.path || "/";

  return (
    <div className={`desktop-cloud-mcp-card ${compact ? "compact" : ""}`}>
      <div className="desktop-cloud-mcp-card-header">
        <span><Server size={15} /></span>
        <div>
          <strong>{endpoint.name || "MCP endpoint"}</strong>
          <small>{accessLabel} · {endpoint.status || "active"}</small>
        </div>
        <button className="desktop-cloud-row-action" type="button" onClick={onOpen}>Open</button>
      </div>
      {serverUrl ? (
        <CloudCommandBlock label="Server URL" value={serverUrl} />
      ) : (
        <div className="desktop-cloud-mcp-key-hint">
          <span>API key</span>
          <strong>{endpoint.api_key_hint || "Hidden"}</strong>
        </div>
      )}
      {!compact && endpoint.description && <p>{endpoint.description}</p>}
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
  const busy = action.projectId === project.id ? action.kind : null;
  return (
    <div className="desktop-cloud-project-row">
      <span><Cloud size={15} /></span>
      <div>
        <strong title={project.name}>{project.name}</strong>
        <small>{project.description || `Updated ${project.updated_at ? formatRelativeTime(project.updated_at) : "recently"}`}</small>
      </div>
      <div className="desktop-cloud-project-row-actions">
        <button type="button" onClick={() => onOpenProject(project.id, "access")}>Open</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => onConnectProject(project)}>
          {busy === "connect" ? "Connecting" : "Use here"}
        </button>
        <button type="button" disabled={Boolean(busy)} onClick={() => onCopyCloneCommand(project)}>
          {busy === "copy" ? "Copying" : "Clone cmd"}
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
