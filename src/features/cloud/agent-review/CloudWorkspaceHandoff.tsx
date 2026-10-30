import { useLocalization } from "@puppyone/localization/react";
import type { WorkspaceHandoff } from "./useWorkspaceHandoff";

/** The person decides when work joins the project; nothing here happens on its own. */
export function CloudWorkspaceHandoff({ handoff }: { handoff: WorkspaceHandoff }) {
  const { t } = useLocalization();
  const { pending, notice, waiting } = handoff;
  return <section className="desktop-cloud-handoff" aria-label={t("cloud.handoff.title")}>
    <h4>{t("cloud.handoff.title")}</h4>
    {waiting.length > 0 && <div className="desktop-cloud-handoff-waiting">
      <strong>{t("cloud.handoff.waiting.title")}</strong>
      <p>{t("cloud.handoff.waiting.description")}</p>
      <ul>{waiting.map(path => <li key={path} dir="ltr">{path}</li>)}</ul>
      <div className="desktop-cloud-handoff-actions">
        <button type="button" className="desktop-dialog-button primary" disabled={pending}
          onClick={() => void handoff.finish()}>{t("cloud.handoff.finish")}</button>
        <button type="button" className="desktop-dialog-button" disabled={pending}
          onClick={() => void handoff.undo()}>{t("cloud.handoff.undo")}</button>
      </div>
    </div>}
    {waiting.length === 0 && <div className="desktop-cloud-handoff-actions">
      <button type="button" className="desktop-dialog-button" disabled={pending}
        onClick={() => void handoff.bringIn(null)}>{t("cloud.handoff.latest")}</button>
      <button type="button" className="desktop-dialog-button primary" disabled={pending}
        onClick={() => void handoff.update()}>{t("cloud.handoff.update")}</button>
    </div>}
    {notice && <p role="status">{t(`cloud.handoff.status.${notice}`)}</p>}
  </section>;
}
