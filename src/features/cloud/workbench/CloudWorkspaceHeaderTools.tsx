import { useState } from "react";
import { Grid2X2 } from "lucide-react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context";
import { McpLogoIcon } from "../components/McpLogoIcon";
import { CloudWorkspaceToolDialog, type CloudWorkspaceTool } from "./CloudWorkspaceToolDialog";

type Props = {
  context: ProjectCloudContext | null;
  session: DesktopCloudSession | null;
  apiBaseUrl: string;
  onSessionChange: (session: DesktopCloudSession | null) => void;
};

/** Both hosted entry paths use the active Cloud identity, never a retained local remote. */
export function CloudWorkspaceHeaderTools(props: Props) {
  const scope = JSON.stringify([props.apiBaseUrl, props.session?.user_id,
    props.session?.session_generation, props.context?.status === "resolved" ? props.context.target : null]);
  return <ScopedCloudWorkspaceHeaderTools key={scope} {...props} />;
}

function ScopedCloudWorkspaceHeaderTools({ context, session, apiBaseUrl, onSessionChange }: Props) {
  const { t } = useLocalization();
  const [tool, setTool] = useState<CloudWorkspaceTool | null>(null);
  const ready = context?.status === "resolved" && session !== null;
  return <>
    <div className="desktop-titlebar-cloud-tools" data-window-no-drag="true" aria-busy={!ready || undefined}>
      {(["automation", "mcp"] as const).map((id) => {
        const label = t(id === "automation" ? "cloud.workspaceTools.automations" : "cloud.workspaceTools.mcp");
        const description = id === "automation" ? t("cloud.route.automation.description") : t("cloud.workspaceTools.connectAgents");
        return <Tooltip key={id} content={ready ? description : t("shell.workspaceSwitcher.location.checking")}>
          <button type="button" className="desktop-titlebar-action desktop-titlebar-cloud-tool"
            data-cloud-workspace-tool={id} disabled={!ready} aria-label={label}
            aria-haspopup="dialog" aria-expanded={tool === id} onClick={() => setTool(id)}>
            {id === "automation" ? <Grid2X2 size={15} aria-hidden="true" /> : <McpLogoIcon size={15} />}
            <span className="desktop-titlebar-cloud-tool-label">{label}</span>
          </button>
        </Tooltip>;
      })}
    </div>
    {tool && context?.status === "resolved" && session && <CloudWorkspaceToolDialog
      tool={tool} context={context} session={session} apiBaseUrl={apiBaseUrl}
      onSessionChange={onSessionChange} onClose={() => setTool(null)} />}
  </>;
}
