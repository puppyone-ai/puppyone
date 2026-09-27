import { ChevronDown, ChevronRight, Monitor } from "lucide-react";
import { useState, type ReactNode } from "react";
import { bidiIsolate, type MessageFormatter } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudRepositoryView } from "../../../../lib/cloudApi";
import {
  CloudAuthorityCell,
  CloudCommandBlock,
} from "../../components/shared";
import {
  type AccessPoint,
} from "../../access-points/model";
import {
  AccessPointIcon,
  formatAccessPointCommandLabel,
  formatAccessPointPrompt,
  formatAccessPointTitle,
  getAccessPointUiDefinition,
  getAccessPointMethodMeta,
} from "../../access-points/presentation";
import {
  isMcpAccessPointPlaceholder,
  isVmAccessPointPlaceholder,
} from "../../access-points/model";
import {
  copyText,
  formatProviderLabel,
  formatStatusLabel,
  getScopeDisplayName,
  getScopePathLabel,
} from "../../utils";
import {
  DesktopCloudPermissionPanel,
  getDesktopCliPermissionGroups,
  getDesktopMcpPermissionGroups,
  getDesktopMcpWritable,
  parseCliCommandPermissions,
  parseMcpToolPermissions,
} from "./AccessMethodPermissions";

export function DesktopCloudAccessMethodCard({
  scope,
  accessPoint,
  expanded,
  creatingMcp,
  mcpError,
  configPending,
  configError,
  onToggle,
  onCreateMcpEndpoint,
  onUpdatePermissions,
  canManage = false,
}: {
  scope: DesktopCloudRepositoryView;
  accessPoint: AccessPoint;
  expanded: boolean;
  creatingMcp: boolean;
  mcpError: string | null;
  configPending: boolean;
  configError: string | null;
  onToggle: () => void;
  onCreateMcpEndpoint: () => void;
  onUpdatePermissions: (nextAllowedKeys: ReadonlySet<string>) => Promise<void>;
  canManage?: boolean;
}) {
  const { t } = useLocalization();
  const meta = getAccessPointMethodMeta(accessPoint, t);
  const live = accessPoint.status.kind === "ready";
  const definition = getAccessPointUiDefinition(accessPoint.kind);
  const promptText = getAccessPointPromptText(scope, accessPoint, t);
  const mcpPlaceholder = isMcpAccessPointPlaceholder(accessPoint);
  const vmPlaceholder = isVmAccessPointPlaceholder(accessPoint);

  if (vmPlaceholder) {
    return <DesktopCloudRemoteWorkspaceCard accessPoint={accessPoint} canManage={canManage} />;
  }

  if (mcpPlaceholder) {
    return (
      <article className="desktop-cloud-access-method-card remote mcp-placeholder">
        <div className="desktop-cloud-access-method-info">
          <span className="desktop-cloud-access-method-icon mcp" aria-hidden="true">
            <AccessPointIcon accessPoint={accessPoint} size={19} />
          </span>
          <div className="desktop-cloud-access-method-main">
            <div className="desktop-cloud-access-method-title-line">
              <h2>{t("cloud.access.surface.mcp.title")}</h2>
              <span aria-hidden="true">·</span>
              <span className={`desktop-cloud-access-method-status ${mcpError ? "error" : "off"}`}>
                <span className={`desktop-cloud-web-status-dot ${mcpError ? "warning" : "muted"}`} aria-hidden="true" />
                {t(mcpError ? "cloud.status.error" : "cloud.status.off")}
              </span>
            </div>
            <p data-tooltip={mcpError ?? meta.description}>{mcpError ?? meta.description}</p>
          </div>
        </div>
        {canManage && <button
          className="desktop-cloud-access-method-remote-button"
          type="button"
          disabled={creatingMcp}
          onClick={onCreateMcpEndpoint}
        >
          <span>{t(creatingMcp ? "cloud.access.method.mcp.creating" : mcpError ? "cloud.common.retry" : "cloud.access.method.mcp.create")}</span>
        </button>}
      </article>
    );
  }

  return (
    <article className={`desktop-cloud-access-method-card ${expanded ? "expanded" : ""}`}>
      <div className="desktop-cloud-access-method-info">
        <span className={`desktop-cloud-access-method-icon ${definition.tileProvider}`} aria-hidden="true">
          <AccessPointIcon accessPoint={accessPoint} size={definition.iconSize} />
        </span>
        <div className="desktop-cloud-access-method-main">
          <div className="desktop-cloud-access-method-title-line">
            <h2>{meta.title}</h2>
            <span aria-hidden="true">·</span>
            <span className={`desktop-cloud-access-method-status ${live ? "active" : ""}`}>
              <span className={`desktop-cloud-web-status-dot ${live ? "ready" : ""}`} aria-hidden="true" />
              {formatStatusLabel(live ? "active" : accessPoint.status.code, t)}
            </span>
          </div>
          <p>{meta.description}</p>
          <div className="desktop-cloud-access-method-actions">
            <button
              className={`desktop-cloud-access-method-outline-button ${expanded ? "active" : ""}`}
              type="button"
              aria-expanded={expanded}
              onClick={onToggle}
            >
              <span>{expanded ? meta.expandedActionLabel : meta.actionLabel}</span>
              {expanded ? <ChevronDown className="desktop-cloud-access-method-expanded-chevron" size={12} /> : meta.actionIcon}
            </button>
          </div>
        </div>
      </div>
      <DesktopCloudAccessPromptPreview
        buttonLabel={meta.previewButtonLabel}
        icon={meta.previewIcon}
        text={promptText}
      />
      {expanded && (
        <DesktopCloudAccessMethodExpandedDetail
          accessPoint={accessPoint}
          scope={scope}
          pending={configPending}
          error={configError}
          onUpdatePermissions={onUpdatePermissions}
          canManage={canManage}
        />
      )}
    </article>
  );
}

export function DesktopCloudRemoteWorkspaceCard({
  accessPoint,
  canManage = false,
}: {
  accessPoint?: AccessPoint;
  canManage?: boolean;
}) {
  const { t } = useLocalization();
  return (
    <article className="desktop-cloud-access-method-card remote">
      <div className="desktop-cloud-access-method-info">
        <span className="desktop-cloud-access-method-icon vm" aria-hidden="true">
          {accessPoint ? <AccessPointIcon accessPoint={accessPoint} size={18} /> : <Monitor size={18} />}
        </span>
        <div className="desktop-cloud-access-method-main">
          <div className="desktop-cloud-access-method-title-line">
            <h2>{accessPoint ? formatAccessPointTitle(accessPoint, t) : t("cloud.access.surface.vm.title")}</h2>
            <span aria-hidden="true">·</span>
            <span className="desktop-cloud-access-method-status off">
              <span className="desktop-cloud-web-status-dot muted" aria-hidden="true" />
              {formatStatusLabel(accessPoint?.status.code || "off", t)}
            </span>
          </div>
          <p>{accessPoint ? formatAccessPointPrompt(accessPoint, t("cloud.scope.workspaceRoot"), t) : t("cloud.access.surface.vm.prompt")}</p>
        </div>
      </div>
      {canManage && <button className="desktop-cloud-access-method-remote-button" type="button">
        <span>{t("cloud.access.method.vm.addSshKey")}</span>
        <ChevronRight className="desktop-cloud-directional-icon" size={13} />
      </button>}
    </article>
  );
}

function DesktopCloudAccessMethodExpandedDetail({
  accessPoint,
  scope,
  pending,
  error,
  onUpdatePermissions,
  canManage,
}: {
  accessPoint: AccessPoint;
  scope: DesktopCloudRepositoryView;
  pending: boolean;
  error: string | null;
  onUpdatePermissions: (nextAllowedKeys: ReadonlySet<string>) => Promise<void>;
  canManage: boolean;
}) {
  const { t } = useLocalization();
  if (accessPoint.kind === "cli") {
    return (
      <div className="desktop-cloud-access-method-expanded-detail">
        <DesktopCloudPermissionPanel
          title={t("cloud.access.permissions.title")}
          groups={getDesktopCliPermissionGroups(scope)}
          allowedKeys={parseCliCommandPermissions(accessPoint.connector?.config)}
          pending={pending}
          error={error}
          canUpdate={canManage && !!accessPoint.connector}
          unavailableLabel={t("cloud.access.permissions.cliUnavailable")}
          onUpdate={onUpdatePermissions}
        />
      </div>
    );
  }
  if (accessPoint.kind === "mcp") {
    const writable = getDesktopMcpWritable(accessPoint.endpoint, scope);
    return (
      <div className="desktop-cloud-access-method-expanded-detail">
        <DesktopCloudPermissionPanel
          title={t("cloud.access.permissions.mcpTools")}
          groups={getDesktopMcpPermissionGroups(writable)}
          allowedKeys={parseMcpToolPermissions(accessPoint.endpoint?.tools_config)}
          pending={pending}
          error={error}
          canUpdate={canManage && !!accessPoint.endpoint}
          unavailableLabel={t("cloud.access.permissions.mcpUnavailable")}
          footer={t("cloud.access.permissions.mcpPolicyFooter")}
          onUpdate={onUpdatePermissions}
        />
      </div>
    );
  }
  const commands = accessPoint.commands?.filter((command) => command.value) ?? [];
  return (
    <div className="desktop-cloud-access-method-expanded-detail">
      {commands.length > 0 ? (
        <div className="desktop-cloud-access-method-command-list">
          {commands.map((command) => (
            <CloudCommandBlock
              key={command.id}
              label={formatAccessPointCommandLabel(command, t)}
              value={command.value}
              disabled={command.disabled}
            />
          ))}
        </div>
      ) : (
        <p className="desktop-cloud-access-method-expanded-note">
          {accessPoint.endpoint?.description || formatAccessPointPrompt(accessPoint, getScopeDisplayName(scope, t), t)}
        </p>
      )}
      <div className="desktop-cloud-access-method-expanded-summary">
        <CloudAuthorityCell label={t("cloud.common.cloudPath")} value={getScopePathLabel(scope)} mono />
        <CloudAuthorityCell label={t("cloud.common.type")} value={formatProviderLabel(accessPoint.sourceProvider, t)} />
        <CloudAuthorityCell
          label={t("cloud.common.status")}
          value={formatStatusLabel(accessPoint.status.code, t)}
          tone={accessPoint.status.kind === "ready" ? "ready" : "warning"}
        />
      </div>
    </div>
  );
}

function DesktopCloudAccessPromptPreview({
  text,
  buttonLabel,
  icon,
}: {
  text: string;
  buttonLabel: string;
  icon: ReactNode;
}) {
  const { t } = useLocalization();
  const [copied, setCopied] = useState(false);

  return (
    <div className="desktop-cloud-access-method-preview">
      <pre aria-hidden="true" dir="auto">{text || t("cloud.access.setupPreparing")}</pre>
      <div className="desktop-cloud-access-method-preview-fade" aria-hidden="true" />
      <button
        className="desktop-cloud-access-method-copy-button"
        type="button"
        disabled={!text}
        onClick={async (event) => {
          event.stopPropagation();
          if (!text) return;
          await copyText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        }}
      >
        {icon}
        <span>{copied ? t("cloud.common.copied") : buttonLabel}</span>
      </button>
    </div>
  );
}

function getAccessPointPromptText(scope: DesktopCloudRepositoryView, accessPoint: AccessPoint, t: MessageFormatter) {
  const commandText = accessPoint.commands
    ?.filter((command) => !command.disabled)
    .map((command) => `${formatAccessPointCommandLabel(command, t)}\n${command.value}`)
    .join("\n\n") ?? "";

  if (accessPoint.kind === "mcp") {
    const endpoint = accessPoint.endpoint;
    return [
      t("cloud.access.surface.mcp.title"),
      commandText || endpoint?.api_key_hint || t("cloud.access.connectionPreparing"),
      "",
      t("cloud.access.prompt.scope", { scope: bidiIsolate(getScopePathLabel(scope)) }),
    ].join("\n");
  }

  return [
    formatAccessPointPrompt(accessPoint, getScopeDisplayName(scope, t), t),
    commandText,
    t("cloud.access.prompt.scope", { scope: bidiIsolate(getScopeDisplayName(scope, t)) }),
  ].filter(Boolean).join("\n\n");
}
