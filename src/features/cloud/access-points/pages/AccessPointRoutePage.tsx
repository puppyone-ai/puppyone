import { useEffect, useMemo, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import type {
  DesktopCloudConnector,
  DesktopCloudMcpEndpoint,
  DesktopCloudRepoIdentity,
  DesktopCloudScope,
  DesktopCloudSession,
} from "../../../../lib/cloudApi";
import { getScopeDisplayName, getScopePathLabel } from "../../utils";
import { DesktopCloudCreateAccessDialog } from "../../sections/access/CreateAccessDialog";
import type { DesktopCloudCreateAccessCreated } from "../../sections/access/CreateAccessDialog";
import { getCreateAccessIntentForCatalogKind } from "../../sections/access/createAccessModel";
import { AccessPointCatalogPage, AccessPointManageDialog } from "../components";
import {
  buildAccessPointProjection,
  selectAccessPointRows,
  type AccessPointCatalogKind,
  type AccessPointStatusFilter,
} from "../model";
import { formatAccessPointTitle } from "../presentation";

export function AccessPointRoutePage({
  kind,
  projectId,
  cloudSession,
  apiBaseUrl,
  identity,
  scopes,
  connectors,
  mcpEndpoints,
  loading,
  canManage,
  onCloudSessionChange,
  onRefresh,
}: {
  kind: AccessPointCatalogKind;
  projectId: string;
  cloudSession: DesktopCloudSession;
  apiBaseUrl: string | null;
  identity: DesktopCloudRepoIdentity | null;
  scopes: DesktopCloudScope[];
  connectors: DesktopCloudConnector[];
  mcpEndpoints: DesktopCloudMcpEndpoint[];
  loading: boolean;
  canManage: boolean;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
  onRefresh: () => Promise<void>;
}) {
  const { locale, t } = useLocalization();
  const [activeKind, setActiveKind] = useState<AccessPointCatalogKind>(kind);
  const [statusFilter, setStatusFilter] = useState<AccessPointStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [createAccessOpen, setCreateAccessOpen] = useState(false);

  useEffect(() => {
    setActiveKind(kind);
    setStatusFilter("all");
    setQuery("");
    setSelectedRowId(null);
  }, [kind]);

  const projection = useMemo(() => buildAccessPointProjection({
    scopes,
    connectors,
    mcpEndpoints,
    identity,
    apiBaseUrl,
    catalogKind: kind,
  }), [apiBaseUrl, connectors, identity, kind, mcpEndpoints, scopes]);
  const visibleRows = useMemo(() => selectAccessPointRows({
    rows: projection.accessPointRows,
    kind: activeKind,
    status: statusFilter,
    query,
    locale,
    getSearchText: (row) => [
      formatAccessPointTitle(row.accessPoint, t),
      row.accessPoint.title,
      row.accessPoint.sourceProvider,
      getScopeDisplayName(row.scope, t),
      getScopePathLabel(row.scope),
    ].join(" "),
  }), [activeKind, locale, projection.accessPointRows, query, statusFilter, t]);
  const selectedRow = projection.accessPointRows.find((row) => row.id === selectedRowId) ?? null;

  const handleAccessCreated = async (created: DesktopCloudCreateAccessCreated) => {
    await onRefresh();
    setSelectedRowId(created.preferredRowId);
  };

  return (
    <>
      <AccessPointCatalogPage
        routeKind={kind}
        selectedKind={activeKind}
        rows={visibleRows}
        totalRowCount={projection.accessPointRows.length}
        loading={loading}
        selectedRowId={selectedRowId}
        query={query}
        statusFilter={statusFilter}
        canManage={canManage}
        onKindChange={setActiveKind}
        onQueryChange={setQuery}
        onStatusFilterChange={setStatusFilter}
        onOpenRow={(row) => setSelectedRowId(row.id)}
        onCreate={() => setCreateAccessOpen(true)}
      />

      {selectedRow && (
        <AccessPointManageDialog
          row={selectedRow}
          projectId={projectId}
          cloudSession={cloudSession}
          apiBaseUrl={apiBaseUrl}
          identity={identity}
          connectorsByTarget={projection.connectorsByTarget}
          mcpEndpointsByTarget={projection.mcpEndpointsByTarget}
          canManage={canManage}
          onCloudSessionChange={onCloudSessionChange}
          onRefresh={onRefresh}
          onClose={() => setSelectedRowId(null)}
        />
      )}

      {canManage && createAccessOpen && (
        <DesktopCloudCreateAccessDialog
          projectId={projectId}
          cloudSession={cloudSession}
          apiBaseUrl={apiBaseUrl}
          scopes={projection.scopeRows}
          connectorsByTarget={projection.connectorsByTarget}
          mcpEndpointsByTarget={projection.mcpEndpointsByTarget}
          initialIntent={getCreateAccessIntentForCatalogKind(kind)}
          onCloudSessionChange={onCloudSessionChange}
          onClose={() => setCreateAccessOpen(false)}
          onCreated={handleAccessCreated}
        />
      )}
    </>
  );
}
