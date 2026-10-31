import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Check } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopTitlebarMenuLayer } from "../../../components/DesktopTitlebarMenuLayer";
import { getDesktopCloudWebUrl, type DesktopCloudSession } from "../../../lib/cloudApi";
import { writeClipboardText } from "../../../lib/clipboard";
import { workspaceResourceUrl } from "../files/workspaceResourceUrl";
import type { ProjectCloudContext } from "../project/context";
import { CloudWorkspaceAgentShare, type ShareAgentMark } from "./CloudWorkspaceAgentShare";
import "./workspace-share.css";
import type { CloudWorkspaceShareResource } from "./cloudWorkspaceShareResource";
import type { WorkspaceAgent } from "./useWorkspaceAgents";

/**
 * Share, as a panel under the button that opens it. It is one column of two
 * offers built alike, a sentence and a button, so neither looks like a form.
 */
export function CloudWorkspaceShareDialog({ anchor, context, resource, session, apiBaseUrl, agents, renderAgentMark, onAgentsChanged, onClose }: {
  anchor: RefObject<HTMLElement | null>;
  context: Extract<ProjectCloudContext, { status: "resolved" }>;
  resource?: CloudWorkspaceShareResource | null;
  /** An Agent connects to the live workspace, which only the whole project can offer. */
  session?: DesktopCloudSession;
  apiBaseUrl?: string;
  /** What the Header knows about each Agent, so the two never disagree. */
  agents?: readonly WorkspaceAgent[];
  /** The Header's identity marks belong to the shell, which lends them to this list. */
  renderAgentMark?: (agent: ShareAgentMark) => ReactNode;
  onAgentsChanged?: () => void;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const url = shareUrl(context, resource);
  const connectsAgents = Boolean(session && apiBaseUrl) && context.target.kind === "project_root";
  const copyLabel = { idle: "cloud.share.people.copy", copying: "cloud.common.copying",
    copied: "cloud.share.action.copied", failed: "cloud.share.people.copy" }[status];
  const copy = async () => {
    if (!url) return;
    setStatus("copying");
    try { await writeClipboardText(url); if (mounted.current) setStatus("copied"); }
    catch { if (mounted.current) setStatus("failed"); }
  };
  return <DesktopTitlebarMenuLayer anchorRef={anchor} open onDismiss={onClose} dismissOnFocusExit={false}
    className="desktop-cloud-workspace-share" gap={6} preferredWidth={380} preferredMaxHeight={560}
    widthMode="fixed" alignment="end" role="dialog" ariaLabel={t("cloud.share.thisProject")}>
    {connectsAgents && session && apiBaseUrl && <CloudWorkspaceAgentShare
      projectId={context.projectId} projectName={context.projectName || context.projectId}
      session={session} apiBaseUrl={apiBaseUrl} agents={agents} renderAgentMark={renderAgentMark}
      onChanged={onAgentsChanged} />}
    {url ? <section className="desktop-cloud-share-people" data-share-url={url}>
      <div className="desktop-cloud-share-offer">
        <div className="desktop-cloud-share-offer-text">
          <h3 dir="auto">{t("cloud.share.people.linkTo", { name: shareName(context, resource) })}</h3>
          {/* The address grants nothing, so a failed copy takes this line rather than adding one. */}
          {status === "failed"
            ? <p role="alert">{t("cloud.share.copyFailed")}</p>
            : <p>{t("cloud.share.people.note")}</p>}
        </div>
        <button type="button" className="desktop-dialog-button desktop-cloud-share-copy"
          disabled={status === "copying"} onClick={() => void copy()}>
          {status === "copied" && <Check size={14} aria-hidden="true" />}
          {t(copyLabel)}
        </button>
      </div>
      <span className="desktop-cloud-share-status" role="status">{status === "copied" ? t(copyLabel) : ""}</span>
      {/* The address is noise until the clipboard fails; then it is the way out. */}
      {status === "failed" && <input className="desktop-cloud-share-address" aria-label={t("cloud.share.handoff.link")}
        readOnly value={url} dir="ltr" onFocus={event => event.currentTarget.select()} />}
    </section> : <p role="alert">{t("cloud.share.publish.unavailable")}</p>}
  </DesktopTitlebarMenuLayer>;
}

/** The last name in what is shared, so the panel says what a link opens without drawing it. */
function shareName(context: Extract<ProjectCloudContext, { status: "resolved" }>, resource?: CloudWorkspaceShareResource | null) {
  const path = resource?.path ?? context.scopePath ?? "";
  return path.split("/").filter(Boolean).at(-1) || context.projectName || context.projectId;
}

function shareUrl(context: Extract<ProjectCloudContext, { status: "resolved" }>, resource?: CloudWorkspaceShareResource | null): string | null {
  if (resource === null) return null;
  if (context.target.kind === "scope" && !context.scopePath) return null;
  const path = resource?.path ?? context.scopePath ?? "";
  if (context.scopePath && path !== context.scopePath && !path.startsWith(`${context.scopePath}/`)) return null;
  try { return workspaceResourceUrl(getDesktopCloudWebUrl("/"), context.projectId, path, resource?.directory ?? true); }
  catch { return null; }
}
