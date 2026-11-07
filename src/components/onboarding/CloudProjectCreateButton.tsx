import { Tooltip } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { DesktopDialogCloseButton, DesktopDialogRoot } from "../DesktopDialog";
import { DesktopOverlayLayer } from "../DesktopOverlayPortal";

const CLOUD_PROJECT_NAME_MAX_LENGTH = 200;

/**
 * New project at the head of a shared group: an empty Cloud project in that group's
 * space, named and then opened. Sharing a project that already exists is a drag.
 */
export function CloudProjectCreateButton({ spaceName, disabled, onCreate }: {
  spaceName: string;
  disabled: boolean;
  onCreate: (name: string) => Promise<void>;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = t("onboarding.spaces.newProject", { name: bidiIsolate(spaceName) });
  const close = () => { if (!pending) setOpen(false); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      await onCreate(trimmed);
      setOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPending(false);
    }
  };

  return <>
    <Tooltip content={title}>
      <button type="button" className="onboarding-group-action" data-onboarding-action="create-cloud"
        aria-label={title} aria-haspopup="dialog" disabled={disabled}
        onClick={() => { setName(t("onboarding.entry.create.defaultName")); setError(null); setOpen(true); }}>
        <Plus size={14} strokeWidth={1.85} aria-hidden="true" />
        <span>{t("onboarding.action.createLocalProject")}</span>
      </button>
    </Tooltip>
    {open && <DesktopOverlayLayer>
      <DesktopDialogRoot dismissOnBackdrop={!pending} onClose={pending ? undefined : close}>
        <form className="desktop-dialog-surface desktop-project-row-dialog" role="dialog" aria-modal
          aria-labelledby="onboarding-cloud-create-title" onSubmit={(event) => void submit(event)}>
          <header className="desktop-dialog-header">
            <div className="desktop-dialog-title-row"><h2 id="onboarding-cloud-create-title">{title}</h2></div>
            <Tooltip content={t("common.action.close")}><DesktopDialogCloseButton
              label={t("common.action.close")} disabled={pending} onClick={close} /></Tooltip>
          </header>
          <div className="desktop-dialog-body">
            <label className="desktop-dialog-field">
              <span>{t("onboarding.entry.create.nameLabel")}</span>
              <input value={name} maxLength={CLOUD_PROJECT_NAME_MAX_LENGTH} disabled={pending}
                data-desktop-dialog-initial-focus="true"
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => { setName(event.target.value); setError(null); }} />
            </label>
            {error && <p className="desktop-dialog-error" role="alert">{error}</p>}
          </div>
          <footer className="desktop-dialog-footer">
            <button className="desktop-dialog-button" type="button" disabled={pending} onClick={close}>
              {t("common.action.cancel")}
            </button>
            <button className="desktop-dialog-button primary" type="submit" disabled={pending || !name.trim()}>
              {t(pending ? "onboarding.entry.create.submitting" : "onboarding.entry.create.submit")}
            </button>
          </footer>
        </form>
      </DesktopDialogRoot>
    </DesktopOverlayLayer>}
  </>;
}
