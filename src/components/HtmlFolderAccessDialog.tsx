import { Tooltip } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { DesktopDialogCloseButton, DesktopDialogRoot, DesktopDialogSurface } from "./DesktopDialog";
import { DesktopOverlayLayer } from "./DesktopOverlayPortal";
import { useCurrentHtmlFolderAccessConsent } from "../lib/htmlFolderAccessConsent";

/**
 * Asks before an HTML page in a project may read and edit text files beside
 * it. Dismissing declines; declining still shows the page, without its folder.
 */
export function HtmlFolderAccessDialog() {
  const { t } = useLocalization();
  const pending = useCurrentHtmlFolderAccessConsent();
  if (!pending) return null;
  const { request, answer } = pending;
  const title = t(request.changed ? "editor.html.folderAccessChangedTitle" : "editor.html.folderAccessTitle");
  const decline = () => answer(false);
  return (
    <DesktopOverlayLayer>
      <DesktopDialogRoot key={pending.id} onClose={decline}>
        <DesktopDialogSurface width={420} ariaLabel={title}>
          <header className="desktop-dialog-header">
            <div className="desktop-dialog-title-row"><h2>{title}</h2></div>
            <Tooltip content={t("common.action.close")}><DesktopDialogCloseButton
              label={t("common.action.close")} onClick={decline} /></Tooltip>
          </header>
          <div className="desktop-dialog-body">
            <p>{t("editor.html.folderAccessDescription", {
              page: bidiIsolate(request.pageName), folder: bidiIsolate(request.folderName),
            })}</p>
          </div>
          <footer className="desktop-dialog-footer">
            {/* Declining holds the focus: a page should not get its folder one Enter away. */}
            <button className="desktop-dialog-button" type="button" data-desktop-dialog-initial-focus="true" onClick={decline}>
              {t("editor.html.folderAccessDecline")}
            </button>
            <button className="desktop-dialog-button primary" type="button" onClick={() => answer(true)}>
              {t("editor.html.folderAccessAllow")}
            </button>
          </footer>
        </DesktopDialogSurface>
      </DesktopDialogRoot>
    </DesktopOverlayLayer>
  );
}
