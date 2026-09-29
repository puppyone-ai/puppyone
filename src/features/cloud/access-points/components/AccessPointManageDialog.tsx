import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../../app-shell/DesktopOverlayPortal";
import type {
  DesktopCloudConnector,
  DesktopCloudMcpEndpoint,
  DesktopCloudRepoIdentity,
  DesktopCloudSession,
} from "../../../../lib/cloudApi";
import { repositoryTargetKey } from "../../repositoryTarget";
import { getScopeDisplayName, getScopePathLabel } from "../../utils";
import { DesktopCloudScopeAccessDetail } from "../../sections/access/ScopeAccessDetail";
import type { AccessPointRow } from "../model";
import { formatAccessPointTitle } from "../presentation";
import "../styles/manage-dialog.css";

export function AccessPointManageDialog({
  row,
  projectId,
  cloudSession,
  apiBaseUrl,
  identity,
  connectorsByTarget,
  mcpEndpointsByTarget,
  canManage,
  onCloudSessionChange,
  onRefresh,
  onClose,
}: {
  row: AccessPointRow;
  projectId: string;
  cloudSession: DesktopCloudSession;
  apiBaseUrl: string | null;
  identity: DesktopCloudRepoIdentity | null;
  connectorsByTarget: Map<string, DesktopCloudConnector[]>;
  mcpEndpointsByTarget: Map<string, DesktopCloudMcpEndpoint[]>;
  canManage: boolean;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const title = formatAccessPointTitle(row.accessPoint, t);
  const targetKey = repositoryTargetKey(row.scope.target);
  return (
    <DesktopOverlayLayer>
      <DesktopDialogRoot onClose={onClose}>
        <DesktopDialogSurface width={920} className="desktop-cloud-access-manage-dialog" ariaLabel={title}>
        <header className="desktop-dialog-header desktop-cloud-access-manage-header">
          <div className="desktop-dialog-title-row">
            <div>
              <h2>{title}</h2>
              <p>{bidiIsolate(`${getScopeDisplayName(row.scope, t)} · ${getScopePathLabel(row.scope)}`)}</p>
            </div>
          </div>
          <DesktopDialogCloseButton label={t("cloud.common.close")} onClick={onClose} />
        </header>
        <div className="desktop-dialog-body desktop-cloud-access-manage-body" data-po-scrollbar="content">
          <DesktopCloudScopeAccessDetail
            projectId={projectId}
            cloudSession={cloudSession}
            onCloudSessionChange={onCloudSessionChange}
            apiBaseUrl={apiBaseUrl}
            scope={row.scope}
            activeAccessPointId={row.accessPoint.id}
            identity={identity}
            connectors={connectorsByTarget.get(targetKey) ?? []}
            mcpEndpoints={mcpEndpointsByTarget.get(targetKey) ?? []}
            onRefresh={onRefresh}
            canManage={canManage}
          />
        </div>
        </DesktopDialogSurface>
      </DesktopDialogRoot>
    </DesktopOverlayLayer>
  );
}
