import { useLocalization } from "@puppyone/localization";
import type { ProjectTemplateImportController } from "./useProjectTemplateImport";

export function ProjectTemplateImportFields({ controller: flow, disabled, onChange }: {
  controller: ProjectTemplateImportController; disabled: boolean; onChange: () => void;
}) {
  const { t } = useLocalization();
  const paste = async () => {
    try { const url = await navigator.clipboard.readText(); flow.setUrl(url); onChange(); await flow.resolve(url); }
    catch { flow.setError(t("onboarding.template.pasteFailed")); }
  };
  return <>
    <label className="onboarding-entry-create-label">
      <input type="checkbox" checked={flow.mode} disabled={disabled} onChange={event => { flow.setMode(event.target.checked); flow.setError(null); onChange(); }} /> {t("onboarding.template.useLink")}
    </label>
    {flow.mode && <div className="onboarding-entry-create-field">
      <label className="onboarding-entry-create-label" htmlFor="template-link">{t("onboarding.template.link")}</label>
      <input id="template-link" className="onboarding-entry-create-input" value={flow.url} placeholder={t("onboarding.template.linkPlaceholder")} disabled={disabled} onChange={event => { flow.setUrl(event.target.value); flow.setTemplate(null); onChange(); }} />
      <div>
        <button className="desktop-dialog-button" type="button" disabled={disabled} onClick={() => void paste()}>{t("onboarding.template.paste")}</button>
        <button className="desktop-dialog-button" type="button" disabled={disabled || !flow.url.trim()} onClick={() => void flow.resolve(flow.url)}>{t(flow.resolving ? "onboarding.template.loading" : "onboarding.template.preview")}</button>
      </div>
      {flow.template && <p className="onboarding-entry-dialog-note">{flow.template.name} · {flow.template.version} · {flow.template.author}<br />{flow.template.description}</p>}
      {!flow.signedIn && <button className="desktop-dialog-button" type="button" disabled={flow.auth.signingIn} onClick={flow.auth.startSignIn}>{t(flow.auth.signingIn ? "onboarding.template.signingIn" : "onboarding.template.signIn")}</button>}
      {flow.error && <p className="desktop-dialog-error" role="alert">{flow.error}</p>}
      {flow.auth.error && <p className="desktop-dialog-error" role="alert">{flow.auth.error}</p>}
    </div>}
  </>;
}
