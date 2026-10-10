import { useEffect, useRef, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";
import { DesktopDialogCloseButton, DesktopDialogRoot, DesktopDialogSurface } from "../../../components/DesktopDialog";
import { getDesktopCloudWebUrl } from "../../../lib/cloudApi";
import { writeClipboardText } from "../../../lib/clipboard";
import { DesktopOverlayLayer } from "../../app-shell/DesktopOverlayPortal";
import { workspaceResourceUrl } from "../files/workspaceResourceUrl";
import type { ProjectCloudContext } from "../project/context";
import { CloudWorkspaceSharePreview, type SharePreviewEntry } from "./CloudWorkspaceSharePreview";
import "./workspace-share.css";

export function CloudWorkspaceShareDialog({ context, previewEntries, onClose }: {
  context: Extract<ProjectCloudContext, { status: "resolved" }>;
  previewEntries?: readonly SharePreviewEntry[];
  onClose: () => void;
}) {
  const { t } = useLocalization();
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const title = t("cloud.share.title", { project: context.projectName || t("cloud.share.workspace") });
  const url = shareUrl(context);
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
      <DesktopDialogSurface width={560} ariaLabel={title} className="desktop-cloud-workspace-share">
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row"><Link2 size={17} aria-hidden="true" /><h2>{title}</h2></div>
          <Tooltip content={t("common.action.close")}><DesktopDialogCloseButton label={t("common.action.close")} onClick={onClose} /></Tooltip>
        </header>
        <div className="desktop-dialog-body">
          {url && <label className="desktop-cloud-share-link"><span>{t("cloud.share.handoff.link")}</span>
            <input readOnly value={url} dir="ltr" onFocus={event => event.currentTarget.select()} />
          </label>}
          {!url && <p role="alert">{t("cloud.share.publish.unavailable")}</p>}
          <p>{t("cloud.share.handoff.linkNote")} {t("cloud.share.scope.workspacePermissions")}</p>
          {url && <CloudWorkspaceSharePreview title={context.projectName || t("cloud.share.workspace")} url={url} entries={previewEntries} />}
          {status === "failed" && <p role="alert">{t("cloud.share.copyFailed")}</p>}
        </div>
        <footer className="desktop-dialog-footer">
          <button type="button" className="desktop-dialog-button primary" data-desktop-dialog-initial-focus="true"
            disabled={!url || status === "copying"} onClick={() => void copy()}>
            {status === "copied" ? <Check size={14} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}
            <span role="status">{t(copyLabel)}</span>
          </button>
        </footer>
      </DesktopDialogSurface>
    </DesktopDialogRoot>
  </DesktopOverlayLayer>;
}

function shareUrl(context: Extract<ProjectCloudContext, { status: "resolved" }>): string | null {
  if (context.target.kind === "scope" && !context.scopePath) return null;
  try { return workspaceResourceUrl(getDesktopCloudWebUrl("/"), context.projectId, context.scopePath || "", true); }
  catch { return null; }
}
