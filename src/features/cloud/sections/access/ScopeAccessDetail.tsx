import { Tooltip } from "@puppyone/shared-ui";
import { Settings } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import "./access.css";
import type {
  DesktopCloudConnector,
  DesktopCloudCreateMcpEndpointRequest,
  DesktopCloudMcpEndpoint,
  DesktopCloudRepoIdentity,
  DesktopCloudRepositoryView,
  DesktopCloudSession,
} from "../../../../lib/cloudApi";
import {
  createCloudMcpEndpoint,
  updateCloudConnector,
  updateCloudMcpEndpoint,
} from "../../../../lib/cloudApi";
import {
  buildAccessPointsForScope,
  getAccessPointAggregate,
  isAccessPointPlaceholder,
  type AccessPoint,
} from "../../access-points/model";
import { formatAccessPointAggregate } from "../../access-points/presentation";
import {
  cloudMessage,
  formatCloudMessage,
  type CloudMessageDescriptor,
} from "../../cloudPresentation";
import {
  getScopeDisplayName,
  getScopePathLabel,
} from "../../utils";
import { DesktopCloudAccessMethodCard } from "./AccessMethodCard";
import {
  CLI_PERMISSION_CONFIG_KEY,
  CLI_VALID_COMMANDS,
  buildMcpToolsConfig,
  sortCliCommands,
} from "./AccessMethodPermissions";
import { CloudScopeSettingsBlock } from "./ScopeSettingsBlock";

export function DesktopCloudScopeAccessDetail({
  projectId,
  cloudSession,
  onCloudSessionChange,
  apiBaseUrl,
  scope,
  activeAccessPointId,
  identity,
  connectors,
  mcpEndpoints,
  onRefresh,
  canManage = false,
}: {
  projectId: string;
  cloudSession: DesktopCloudSession;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
  apiBaseUrl: string | null;
  scope: DesktopCloudRepositoryView;
  activeAccessPointId?: string | null;
  identity: DesktopCloudRepoIdentity | null;
  connectors: DesktopCloudConnector[];
  mcpEndpoints: DesktopCloudMcpEndpoint[];
  onRefresh: () => Promise<void>;
  canManage?: boolean;
}) {
  const { t } = useLocalization();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expandedAccessPointId, setExpandedAccessPointId] = useState<string | null>(null);
  const [creatingMcp, setCreatingMcp] = useState(false);
  const [mcpError, setMcpError] = useState<CloudMessageDescriptor | null>(null);
  const [accessPointConfigBusyId, setAccessPointConfigBusyId] = useState<string | null>(null);
  const [accessPointConfigError, setAccessPointConfigError] = useState<CloudMessageDescriptor | null>(null);

  useEffect(() => {
    setSettingsOpen(false);
    setExpandedAccessPointId(activeAccessPointId ?? null);
    setMcpError(null);
    setAccessPointConfigBusyId(null);
    setAccessPointConfigError(null);
  }, [activeAccessPointId, scope.id]);

  const scopeName = getScopeDisplayName(scope, t);
  const accessPoints = useMemo(() => buildAccessPointsForScope({
    scope,
    identity,
    apiBaseUrl,
    connectors,
    mcpEndpoints,
    placeholderKinds: ["mcp", "vm"],
  }), [apiBaseUrl, connectors, identity, mcpEndpoints, scope]);
  const selectedAccessPoint = activeAccessPointId
    ? accessPoints.find((accessPoint) => accessPoint.id === activeAccessPointId) ?? null
    : null;
  const detailAccessPoints = activeAccessPointId
    ? (selectedAccessPoint ? [selectedAccessPoint] : [])
    : accessPoints;
  const aggregateSource = detailAccessPoints.length > 0 ? detailAccessPoints : accessPoints;
  const configuredAccessPoints = aggregateSource.filter((accessPoint) => !isAccessPointPlaceholder(accessPoint));
  const aggregateInput = configuredAccessPoints.length > 0 ? configuredAccessPoints : aggregateSource;
  const aggregate = aggregateInput.length > 0
    ? getAccessPointAggregate(aggregateInput)
    : { code: "paused", tone: "" } as const;
  const aggregateTone = aggregate.tone === "ready" ? "ready" : aggregate.tone === "warning" ? "warning" : "muted";
  const aggregateConnectorCount = configuredAccessPoints.length;
  const scopePath = getScopePathLabel(scope);
  const modeLabel = t(scope.max_mode === "rw" ? "cloud.scope.readWrite" : "cloud.scope.readOnly");

  const handleCreateMcpEndpoint = async () => {
    if (creatingMcp || !canManage) return;
    setCreatingMcp(true);
    setMcpError(null);
    const body: DesktopCloudCreateMcpEndpointRequest = {
      project_id: projectId,
      path: scope.path,
      name: "MCP Server",
      accesses: [{ path: scope.path, json_path: "", readonly: scope.max_mode !== "rw" }],
    };
    try {
      await createCloudMcpEndpoint(cloudSession, body, onCloudSessionChange, apiBaseUrl);
      await onRefresh();
    } catch (error) {
      setMcpError(cloudMessage("create-mcp-failed", undefined, error instanceof Error ? error.message : undefined));
    } finally {
      setCreatingMcp(false);
    }
  };

  const handleUpdateAccessPointPermissions = async (accessPoint: AccessPoint, allowedKeys: ReadonlySet<string>) => {
    if (accessPointConfigBusyId || !canManage) return;
    setAccessPointConfigBusyId(accessPoint.id);
    setAccessPointConfigError(null);
    try {
      if (accessPoint.kind === "cli") {
        if (!accessPoint.connector) {
          setAccessPointConfigError(cloudMessage("cli-unavailable"));
          return;
        }
        await updateCloudConnector(
          cloudSession,
          projectId,
          accessPoint.connector.id,
          {
            config: {
              ...(accessPoint.connector.config ?? {}),
              [CLI_PERMISSION_CONFIG_KEY]: {
                allowed: Array.from(allowedKeys).filter((key) => CLI_VALID_COMMANDS.has(key)).sort(sortCliCommands),
              },
            },
          },
          onCloudSessionChange,
          apiBaseUrl,
        );
      } else if (accessPoint.kind === "mcp") {
        if (!accessPoint.endpoint) {
          setAccessPointConfigError(cloudMessage("mcp-unavailable"));
          return;
        }
        await updateCloudMcpEndpoint(
          cloudSession,
          accessPoint.endpoint.id,
          {
            tools_config: buildMcpToolsConfig(accessPoint.endpoint.tools_config, allowedKeys),
          },
          onCloudSessionChange,
          apiBaseUrl,
        );
      }
      await onRefresh();
    } catch (error) {
      setAccessPointConfigError(cloudMessage("update-config-failed", undefined, error instanceof Error ? error.message : undefined));
    } finally {
      setAccessPointConfigBusyId(null);
    }
  };

  return (
    <div
      className="desktop-cloud-access-web-detail"
      data-po-scrollbar="content"
      key={scope.id}
    >
      <div className="desktop-cloud-access-web-rail">
        <header className="desktop-cloud-access-web-scope-header">
          <div className="desktop-cloud-access-web-scope-copy">
            <Tooltip content={scopeName} overflowOnly><h1>{scopeName}</h1></Tooltip>
            <div className={`desktop-cloud-access-web-aggregate ${aggregateTone}`}>
              <span className={`desktop-cloud-web-status-dot ${aggregateTone === "ready" ? "ready" : aggregateTone === "warning" ? "warning" : ""}`} aria-hidden="true" />
              <strong>{formatAccessPointAggregate(aggregate.code, t)}</strong>
              <span aria-hidden="true">·</span>
              <em>{t("cloud.access.connectorCount", { count: aggregateConnectorCount })}</em>
            </div>
            <div className="desktop-cloud-access-web-meta">
              <span>{t("cloud.common.scope")}</span>
              <Tooltip content={scopePath} overflowOnly><code>{scopePath}</code></Tooltip>
              <span aria-hidden="true">·</span>
              <span>{modeLabel}</span>
            </div>
          </div>
          {canManage && <Tooltip content={t(settingsOpen ? "cloud.common.closeSettings" : "cloud.common.openSettings")}><button
            className={`desktop-cloud-access-settings-button ${settingsOpen ? "active" : ""}`}
            type="button"
            aria-pressed={settingsOpen}
            aria-label={t(settingsOpen ? "cloud.scope.closeSettings" : "cloud.scope.openSettings")}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Settings size={13} />
          </button></Tooltip>}
        </header>

        {canManage && settingsOpen && (
          <section className="desktop-cloud-access-web-settings">
            <span className="desktop-cloud-access-section-label">{t("cloud.common.settings")}</span>
            <div className="desktop-cloud-access-web-settings-body">
              <CloudScopeSettingsBlock
                projectId={projectId}
                session={cloudSession}
                scope={scope}
                apiBaseUrl={apiBaseUrl}
                onSessionChange={onCloudSessionChange}
                onMutated={onRefresh}
              />
            </div>
          </section>
        )}

        <section className="desktop-cloud-access-method-list" aria-label={t("cloud.access.methods")}>
          {detailAccessPoints.map((accessPoint) => (
            <DesktopCloudAccessMethodCard
              key={accessPoint.id}
              scope={scope}
              accessPoint={accessPoint}
              expanded={expandedAccessPointId === accessPoint.id}
              creatingMcp={creatingMcp}
              mcpError={mcpError ? formatCloudMessage(mcpError, t) : null}
              configPending={accessPointConfigBusyId === accessPoint.id}
              configError={expandedAccessPointId === accessPoint.id && accessPointConfigError ? formatCloudMessage(accessPointConfigError, t) : null}
              onToggle={() => setExpandedAccessPointId((current) => (current === accessPoint.id ? null : accessPoint.id))}
              onCreateMcpEndpoint={handleCreateMcpEndpoint}
              onUpdatePermissions={(nextAllowedKeys) => handleUpdateAccessPointPermissions(accessPoint, nextAllowedKeys)}
              canManage={canManage}
            />
          ))}
        </section>
      </div>
    </div>
  );
}
