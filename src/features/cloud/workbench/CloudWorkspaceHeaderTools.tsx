import { lazy, Suspense, useState } from "react";
import { Forward, History } from "lucide-react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { AgentEntryIcon } from "../../../components/brand/AgentEntryIcon";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context";
import type { CloudWorkspaceShareResource } from "../share/cloudWorkspaceShareResource";

const ShareDialog = lazy(() => import("../share/CloudWorkspaceShareDialog").then(module => ({ default: module.CloudWorkspaceShareDialog })));

type Props = {
  context: ProjectCloudContext | null;
  getShareResource?: () => CloudWorkspaceShareResource | null;
  session: DesktopCloudSession | null;
  apiBaseUrl: string;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  historyOpen?: boolean;
  onToggleHistory?: () => void;
  agentOpen?: boolean;
  onToggleAgent?: () => void;
};

/** Both hosted entry paths use the active Cloud identity, never a retained local remote. */
export function CloudWorkspaceHeaderTools(props: Props) {
  const scope = JSON.stringify([props.apiBaseUrl, props.session?.user_id,
    props.session?.session_generation, props.context?.status === "resolved" ? props.context.target : null]);
  return <ScopedCloudWorkspaceHeaderTools key={scope} {...props} />;
}

function ScopedCloudWorkspaceHeaderTools({ context, session, apiBaseUrl, getShareResource, historyOpen = false, onToggleHistory, agentOpen = false, onToggleAgent }: Props) {
  const { t } = useLocalization();
  const [sharing, setSharing] = useState(false);
  const [shareResource, setShareResource] = useState<CloudWorkspaceShareResource | null | undefined>();
  const ready = context?.status === "resolved" && session !== null;
  return <>
    <div className="desktop-titlebar-cloud-tools" data-window-no-drag="true" aria-busy={!ready || undefined}>
      <Tooltip content={ready ? t("shell.titlebar.share") : t("shell.workspaceSwitcher.location.checking")}>
        <button type="button" className="desktop-titlebar-action desktop-titlebar-share"
          data-cloud-workspace-tool="share" disabled={!ready} aria-label={t("shell.titlebar.share")}
          aria-haspopup="dialog" aria-expanded={sharing} onClick={() => {
            try { setShareResource(getShareResource?.()); }
            catch { setShareResource(null); }
            setSharing(true);
          }}>
          <Forward size={16} strokeWidth={1.8} aria-hidden="true" />
          <span className="desktop-titlebar-share-label">{t("shell.titlebar.share")}</span>
        </button>
      </Tooltip>
      <Tooltip content={t("source-control.history.title")}>
        <button type="button" className="desktop-titlebar-action desktop-titlebar-cloud-tool"
          data-cloud-workspace-tool="history" disabled={!ready || !onToggleHistory || context?.status !== "resolved" || context.target.kind !== "project_root"}
          aria-label={t("source-control.history.title")} aria-pressed={historyOpen}
          aria-expanded={historyOpen} onClick={onToggleHistory}>
          <History size={15} aria-hidden="true" />
        </button>
      </Tooltip>
      <span className="desktop-titlebar-action-divider" aria-hidden="true" />
      <Tooltip content={t(agentOpen ? "shell.titlebar.hideAgent" : "shell.titlebar.showAgent")}>
        <button type="button" className="desktop-titlebar-action desktop-titlebar-terminal"
          data-cloud-workspace-tool="agent" disabled={!ready || !onToggleAgent}
          aria-label={t(agentOpen ? "shell.titlebar.hideAgent" : "shell.titlebar.showAgent")}
          aria-pressed={agentOpen} aria-expanded={agentOpen} onClick={onToggleAgent}>
          <AgentEntryIcon size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
    {sharing && context?.status === "resolved" && session && <Suspense fallback={null}>
      <ShareDialog context={context} resource={shareResource} session={session} apiBaseUrl={apiBaseUrl}
        onClose={() => setSharing(false)} />
    </Suspense>}
  </>;
}
