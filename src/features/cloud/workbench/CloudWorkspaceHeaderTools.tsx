import { useState } from "react";
import { Grid2X2, Plug } from "lucide-react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { AgentEntryIcon } from "../../../components/brand/AgentEntryIcon";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context";
import { CloudWorkspaceToolDialog, type CloudWorkspaceTool } from "./CloudWorkspaceToolDialog";

type Props = {
  context: ProjectCloudContext | null;
  session: DesktopCloudSession | null;
  apiBaseUrl: string;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  agentOpen?: boolean;
  onToggleAgent?: () => void;
};

/** Both hosted entry paths use the active Cloud identity, never a retained local remote. */
export function CloudWorkspaceHeaderTools(props: Props) {
  const scope = JSON.stringify([props.apiBaseUrl, props.session?.user_id,
    props.session?.session_generation, props.context?.status === "resolved" ? props.context.target : null]);
  return <ScopedCloudWorkspaceHeaderTools key={scope} {...props} />;
}

function ScopedCloudWorkspaceHeaderTools({ context, session, apiBaseUrl, onSessionChange, agentOpen = false, onToggleAgent }: Props) {
  const { t } = useLocalization();
  const [tool, setTool] = useState<CloudWorkspaceTool | null>(null);
  const ready = context?.status === "resolved" && session !== null;
  return <>
    <div className="desktop-titlebar-cloud-tools" data-window-no-drag="true" aria-busy={!ready || undefined}>
      {(["automation", "connect"] as const).map((id) => {
        const label = t(id === "automation" ? "cloud.workspaceTools.automations" : "cloud.workspaceTools.connect");
        const description = id === "automation" ? t("cloud.route.automation.description") : label;
        return <Tooltip key={id} content={ready ? description : t("shell.workspaceSwitcher.location.checking")}>
          <button type="button" className="desktop-titlebar-action desktop-titlebar-cloud-tool"
            data-cloud-workspace-tool={id} disabled={!ready} aria-label={label}
            aria-haspopup="dialog" aria-expanded={tool === id} onClick={() => setTool(id)}>
            {id === "automation" ? <Grid2X2 size={15} aria-hidden="true" /> : <Plug size={15} aria-hidden="true" />}
          </button>
        </Tooltip>;
      })}
      <Tooltip content={t(agentOpen ? "shell.titlebar.hideAgent" : "shell.titlebar.showAgent")}>
        <button type="button" className="desktop-titlebar-action desktop-titlebar-terminal"
          data-cloud-workspace-tool="agent" disabled={!ready || !onToggleAgent}
          aria-label={t(agentOpen ? "shell.titlebar.hideAgent" : "shell.titlebar.showAgent")}
          aria-pressed={agentOpen} aria-expanded={agentOpen} onClick={onToggleAgent}>
          <AgentEntryIcon size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
    {tool && context?.status === "resolved" && session && <CloudWorkspaceToolDialog
      tool={tool} context={context} session={session} apiBaseUrl={apiBaseUrl}
      onSessionChange={onSessionChange} onClose={() => setTool(null)} />}
  </>;
}
