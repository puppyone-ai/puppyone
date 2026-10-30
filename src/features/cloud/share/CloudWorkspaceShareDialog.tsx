import { useEffect, useRef, useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopDialogCloseButton, DesktopDialogRoot, DesktopDialogSurface } from "../../../components/DesktopDialog";
import { getDesktopCloudWebUrl, type DesktopCloudSession } from "../../../lib/cloudApi";
import { writeClipboardText } from "../../../lib/clipboard";
import { DesktopOverlayLayer } from "../../../components/DesktopOverlayPortal";
import { workspaceResourceUrl } from "../files/workspaceResourceUrl";
import type { ProjectCloudContext } from "../project/context";
import { CloudWorkspaceAgentShare } from "./CloudWorkspaceAgentShare";
import { CloudWorkspaceSharePreview, type SharePreviewEntry } from "./CloudWorkspaceSharePreview";
import "./workspace-share.css";
import type { CloudWorkspaceShareResource } from "./cloudWorkspaceShareResource";

export function CloudWorkspaceShareDialog({ context, resource, previewEntries, session, apiBaseUrl, onClose }: {
  context: Extract<ProjectCloudContext, { status: "resolved" }>;
  previewEntries?: readonly SharePreviewEntry[];
  resource?: CloudWorkspaceShareResource | null;
  /** An Agent connects to the live workspace, which only the whole project can offer. */
  session?: DesktopCloudSession;
  apiBaseUrl?: string;
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const title = t("cloud.share.thisProject");
  const url = shareUrl(context, resource);
  const copyLabel = { idle: "workspace.node.copyLink", copying: "cloud.common.copying",
    copied: "cloud.share.action.copied", failed: "workspace.node.copyLink" }[status];
  const copy = async () => {
    if (!url) return;
    setStatus("copying");
    try { await writeClipboardText(url); if (mounted.current) setStatus("copied"); }
    catch { if (mounted.current) setStatus("failed"); }
  };
  return <DesktopOverlayLayer>
    <DesktopDialogRoot onClose={onClose}>
      <DesktopDialogSurface width={520} ariaLabel={title} className="desktop-cloud-workspace-share">
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row"><Link2 size={17} aria-hidden="true" /><h2>{title}</h2></div>
          <Tooltip content={t("common.action.close")}><DesktopDialogCloseButton label={t("common.action.close")} onClick={onClose} /></Tooltip>
        </header>
        <div className="desktop-dialog-body">
          {session && apiBaseUrl && context.target.kind === "project_root" && <CloudWorkspaceAgentShare
            projectId={context.projectId} projectName={context.projectName || context.projectId}
            session={session} apiBaseUrl={apiBaseUrl} />}
          {url && session && <h3 className="desktop-cloud-share-people">{t("cloud.share.people.title")}</h3>}
          {url && <div className="desktop-cloud-share-link">
            <input aria-label={t("cloud.share.handoff.link")} readOnly value={url} dir="ltr" onFocus={event => event.currentTarget.select()} />
            <Tooltip content={t(copyLabel)}>
              <button type="button" className="desktop-dialog-button desktop-cloud-share-copy"
                aria-label={t(copyLabel)}
                disabled={status === "copying"} onClick={() => void copy()}>
                {status === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              </button>
            </Tooltip>
            <span className="desktop-cloud-share-status" role="status">{status === "copied" ? t(copyLabel) : ""}</span>
          </div>}
          {!url && <p role="alert">{t("cloud.share.publish.unavailable")}</p>}
          {url && <CloudWorkspaceSharePreview entries={resource === undefined ? previewEntries : resource?.entries} file={resource?.file} />}
          {status === "failed" && <p role="alert">{t("cloud.share.copyFailed")}</p>}
        </div>
      </DesktopDialogSurface>
    </DesktopDialogRoot>
  </DesktopOverlayLayer>;
}

function shareUrl(context: Extract<ProjectCloudContext, { status: "resolved" }>, resource?: CloudWorkspaceShareResource | null): string | null {
  if (resource === null) return null;
  if (context.target.kind === "scope" && !context.scopePath) return null;
  const path = resource?.path ?? context.scopePath ?? "";
  if (context.scopePath && path !== context.scopePath && !path.startsWith(`${context.scopePath}/`)) return null;
  try { return workspaceResourceUrl(getDesktopCloudWebUrl("/"), context.projectId, path, resource?.directory ?? true); }
  catch { return null; }
}
