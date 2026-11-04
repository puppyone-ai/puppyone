import type { ReactNode } from "react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopDialogCloseButton, DesktopDialogRoot, DesktopDialogSurface } from "../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../../components/DesktopOverlayPortal";
import { CloudWorkspaceAgentInvite } from "./CloudWorkspaceAgentInvite";
import type { AgentsPanelControl, ShareAgentMark } from "./CloudWorkspaceAgentsPanel";
import "./workspace-share.css";

/**
 * Inviting another Agent, as a dialog of its own like Manage agents: the
 * Agents menu says who is here, and a form to copy from and wait on does not
 * belong inside it. It stays open after copying, saying what to do next and
 * that the Agent is awaited; the Agent then asks to join in the Agents menu.
 */
export function CloudWorkspaceAgentInviteDialog({ control, renderAgentMark, onClose }: {
  control: AgentsPanelControl;
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const title = t("cloud.share.agent.invite.title");
  return <DesktopOverlayLayer>
    <DesktopDialogRoot onClose={onClose}>
      <DesktopDialogSurface className="desktop-cloud-agent-invite-dialog" width={440} ariaLabel={title}>
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row">
            <h2>{title}</h2>
          </div>
          <Tooltip content={t("common.action.close")}>
            <DesktopDialogCloseButton label={t("common.action.close")} onClick={onClose} />
          </Tooltip>
        </header>
        <div className="desktop-dialog-body desktop-cloud-agents-dialog-body">
          <CloudWorkspaceAgentInvite another initialFocus session={control.session} apiBaseUrl={control.apiBaseUrl}
            projectId={control.projectId} projectName={control.projectName} waiting={control.waiting}
            onInvited={control.onInvited} renderAgentMark={renderAgentMark} />
        </div>
      </DesktopDialogSurface>
    </DesktopDialogRoot>
  </DesktopOverlayLayer>;
}
