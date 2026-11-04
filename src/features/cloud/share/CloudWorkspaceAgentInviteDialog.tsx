import type { ReactNode } from "react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopDialogCloseButton, DesktopDialogRoot, DesktopDialogSurface } from "../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../../components/DesktopOverlayPortal";
import { CloudWorkspaceAgentInvite } from "./CloudWorkspaceAgentInvite";
import type { AgentRequest } from "./agentLinks";
import type { WorkspaceAgent } from "./useWorkspaceAgents";
import type { ShareAgentMark } from "./agentMark";
import type { AgentsPanelControl } from "./CloudWorkspaceAgentsPanel";
import "./workspace-share.css";

/**
 * Inviting another Agent, as a dialog of its own like Manage agents: the
 * Agents menu says who is here, and a ticket to hand out and wait on does not
 * belong inside it. It stays open after copying: the ticket says it is handed
 * out, and the Agent comes to the door under it, to be let in right here.
 */
export function CloudWorkspaceAgentInviteDialog({ control, agents = [], requests = [], renderAgentMark, onClose }: {
  control: AgentsPanelControl;
  /** Who is here and who asks to join, as the Header knows them, for the ticket's door. */
  agents?: readonly WorkspaceAgent[];
  requests?: readonly AgentRequest[];
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
          <CloudWorkspaceAgentInvite initialFocus session={control.session} apiBaseUrl={control.apiBaseUrl}
            projectId={control.projectId} projectName={control.projectName} waiting={control.waiting}
            onInvited={control.onInvited} renderAgentMark={renderAgentMark}
            door={{ agents, requests, onChanged: control.onChanged }} />
        </div>
      </DesktopDialogSurface>
    </DesktopDialogRoot>
  </DesktopOverlayLayer>;
}
