import { Plus, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  DesktopCloudConnector,
  DesktopCloudMcpEndpoint,
  DesktopCloudRepoIdentity,
  DesktopCloudScope,
} from "../../../../lib/cloudApi";
import { PageLoading } from "../../../../components/loading";
import type { CloudWorkspaceSection } from "../../types";
import {
  CloudAuthorityCell,
  CloudCommandBlock,
  CloudWebEmpty,
} from "../../components/shared";
import { buildCloudAccessSurfaces, type CloudAccessSurface } from "../../model";
import {
  formatProviderLabel,
  formatStatusLabel,
  getCloudScopeRows,
  getScopePathLabel,
  getApiBaseFromGitUrl,
  getScopeDisplayName,
  isConnectorActiveStatus,
  profileSlug,
  providerIcon,
  scopeMatchesMcpEndpoint,
  shellQuote,
} from "../../utils";

type CloudAccessSurfaceRow = {
  id: string;
  scope: DesktopCloudScope;
  surface: CloudAccessSurface;
};

export function CloudAccessSection({
  projectId,
  apiBaseUrl,
  identity,
  scopes,
  connectors,
  mcpEndpoints,
  loading,
  onOpenProject,
}: {
  projectId: string;
  apiBaseUrl: string | null;
  identity: DesktopCloudRepoIdentity | null;
  scopes: DesktopCloudScope[];
  connectors: DesktopCloudConnector[];
  mcpEndpoints: DesktopCloudMcpEndpoint[];
  loading: boolean;
  onOpenProject: (projectId: string, section?: CloudWorkspaceSection) => void;
}) {
  const scopeRows = getCloudScopeRows(scopes, identity);
  const scopeKey = scopeRows.map((scope) => scope.id).join("|");
  const apiBase = identity?.url ? getApiBaseFromGitUrl(identity.url) : apiBaseUrl ?? "";
  const accessRows = scopeRows.flatMap((scope): CloudAccessSurfaceRow[] => {
    const scopeConnectors = connectors.filter((connector) => connector.scope_id === scope.id);
    const scopeMcpEndpoints = mcpEndpoints.filter((endpoint) => scopeMatchesMcpEndpoint(scope, endpoint));
    const scopeName = getScopeDisplayName(scope);
    const profileName = profileSlug(scopeName);
    const gitUrl = scope.access_key && apiBase ? `${apiBase}/git/ap/${scope.access_key}.git` : identity?.url ?? "";
    const cliCommand = scope.access_key && apiBase
      ? `printf '%s' ${shellQuote(scope.access_key)} | puppyone ap login ${shellQuote(profileName)} --api-url ${shellQuote(apiBase)} --access-key-stdin`
      : "";

    return buildCloudAccessSurfaces({
      scope,
      connectors: scopeConnectors,
      mcpEndpoints: scopeMcpEndpoints,
      apiBase,
      gitUrl,
      cliCommand,
      profileName,
    }).map((surface) => ({
      id: `${scope.id}:${surface.id}`,
      scope,
      surface,
    }));
  });
  const accessRowKey = accessRows.map((row) => row.id).join("|");
  const [detailRowId, setDetailRowId] = useState<string | null>(null);

  useEffect(() => {
    if (detailRowId && !accessRows.some((row) => row.id === detailRowId)) {
      setDetailRowId(null);
    }
  }, [scopeKey, accessRowKey, detailRowId]);

  useEffect(() => {
    if (!detailRowId) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailRowId(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [detailRowId]);

  const detailRow = accessRows.find((row) => row.id === detailRowId) ?? null;

  return (
    <section className="desktop-cloud-access-page list-view">
      <div className="desktop-cloud-access-hero">
        <div>
          <h1>Access</h1>
          <p>Manage Git, CLI, MCP, and integration access for this Cloud project.</p>
        </div>
        <button className="desktop-cloud-row-action" type="button" onClick={() => onOpenProject(projectId, "access")}>
          <Plus size={14} />
          <span>New access</span>
        </button>
      </div>
      {loading ? (
        <PageLoading variant="fill" label="Loading" className="desktop-cloud-web-loading" />
      ) : scopeRows.length === 0 ? (
        <CloudWebEmpty
          icon={ShieldCheck}
          title="No access surfaces"
          detail="Open the Cloud Access page to create a scoped key, MCP endpoint, or connector."
        />
      ) : (
        <div className="desktop-cloud-access-list-layout">
          <section className="desktop-cloud-access-folder-section">
            <div className="desktop-cloud-access-folder-table" role="table" aria-label="Cloud access surfaces">
              <div className="desktop-cloud-access-folder-row header" role="row">
                <span>Access</span>
                <span>Cloud path</span>
                <span>Status</span>
                <span />
              </div>
              {accessRows.map(({ id, scope, surface }) => {
                const SurfaceIcon = providerIcon(surface.provider);
                const live = isConnectorActiveStatus(surface.status);
                const statusLabel = live ? "Live" : formatStatusLabel(surface.statusLabel || surface.status);
                return (
                  <button
                    className="desktop-cloud-access-folder-row"
                    key={id}
                    type="button"
                    role="row"
                    title={`${surface.title} · ${getScopePathLabel(scope)}`}
                    onClick={() => setDetailRowId(id)}
                  >
                    <span className="desktop-cloud-access-folder-name" role="cell">
                      <span className="desktop-cloud-access-folder-icon" aria-hidden="true">
                        <SurfaceIcon size={15} />
                      </span>
                      <span>
                        <strong>{surface.title}</strong>
                        <small>{surface.subtitle}</small>
                      </span>
                    </span>
                    <span className="desktop-cloud-access-folder-path" role="cell">
                      <code>{getScopePathLabel(scope)}</code>
                    </span>
                    <span className="desktop-cloud-access-folder-status" role="cell">
                      <span className={`desktop-cloud-access-status-pill ${live ? "live" : "muted"}`}>
                        <span className={`desktop-cloud-web-status-dot ${live ? "ready" : ""}`} aria-hidden="true" />
                        {statusLabel}
                      </span>
                    </span>
                    <span className="desktop-cloud-access-folder-action" role="cell">
                      <span>Open</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {detailRow && (
            <div className="desktop-cloud-access-detail-overlay" role="presentation">
              <button
                className="desktop-cloud-access-detail-scrim"
                type="button"
                aria-label="Close access details"
                onClick={() => setDetailRowId(null)}
              />
              <section
                className="desktop-cloud-access-detail-modal"
                role="dialog"
                aria-modal="true"
                aria-label={`${detailRow.surface.title} access details`}
              >
                <button
                  className="desktop-cloud-access-detail-close"
                  type="button"
                  aria-label="Close access details"
                  onClick={() => setDetailRowId(null)}
                >
                  <X size={15} />
                </button>
                <div className="desktop-cloud-access-detail">
                  <CloudAccessSurfaceDetail
                    row={detailRow}
                    onOpenAccess={() => onOpenProject(projectId, "access")}
                  />
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CloudAccessSurfaceDetail({
  row,
  onOpenAccess,
}: {
  row: CloudAccessSurfaceRow;
  onOpenAccess: () => void;
}) {
  const { scope, surface } = row;
  const Icon = providerIcon(surface.provider);
  const live = isConnectorActiveStatus(surface.status);
  const statusLabel = live ? "Live" : formatStatusLabel(surface.statusLabel || surface.status);

  return (
    <div className="desktop-cloud-access-surface-detail-panel">
      <header className="desktop-cloud-access-surface-detail-header">
        <span className={`desktop-cloud-access-provider-tile ${surface.provider}`} aria-hidden="true">
          <Icon size={surface.provider === "cli" ? 16 : 15} />
        </span>
        <div>
          <h1>{surface.title}</h1>
          <p>{surface.subtitle}</p>
        </div>
        <span className={`desktop-cloud-access-status-pill ${live ? "live" : "muted"}`}>
          <span className={`desktop-cloud-web-status-dot ${live ? "ready" : ""}`} aria-hidden="true" />
          {statusLabel}
        </span>
      </header>

      <div className="desktop-cloud-access-surface-detail-meta">
        <CloudAuthorityCell label="Cloud path" value={getScopePathLabel(scope)} mono />
        <CloudAuthorityCell label="Type" value={formatProviderLabel(surface.provider)} />
        {surface.connector && (
          <CloudAuthorityCell
            label="Direction"
            value={surface.connector.direction || "manual"}
          />
        )}
        {surface.endpoint && (
          <CloudAuthorityCell
            label="Endpoint"
            value={surface.endpoint.api_key_hint || "Hidden"}
          />
        )}
      </div>

      {surface.prompt && <p className="desktop-cloud-access-surface-detail-note">{surface.prompt}</p>}

      {surface.commands?.length ? (
        <div className="desktop-cloud-access-surface-detail-commands">
          {surface.commands.map((command) => (
            <CloudCommandBlock
              key={command.label}
              label={command.label}
              value={command.value}
              disabled={command.disabled}
            />
          ))}
        </div>
      ) : null}

      {surface.connector && (
        <div className="desktop-cloud-access-connector-summary">
          <CloudAuthorityCell label="Provider" value={formatProviderLabel(surface.connector.provider)} />
          <CloudAuthorityCell label="Direction" value={surface.connector.direction || "manual"} />
          <CloudAuthorityCell
            label="Status"
            value={formatStatusLabel(surface.connector.status)}
            tone={isConnectorActiveStatus(surface.connector.status) ? "ready" : "warning"}
          />
        </div>
      )}

      {surface.endpoint?.description && (
        <p className="desktop-cloud-access-expanded-note">{surface.endpoint.description}</p>
      )}

      <div className="desktop-cloud-access-surface-detail-footer">
        <button className="desktop-cloud-row-action" type="button" onClick={onOpenAccess}>
          Open Cloud settings
        </button>
      </div>
    </div>
  );
}
