import { useState, type FormEvent } from "react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { DesktopDialogCloseButton, DesktopDialogRoot, DesktopDialogSurface } from "../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../../components/DesktopOverlayPortal";
import { createCloudTeam, type DesktopCloudOrganization, type DesktopCloudSession } from "../../../lib/cloudApi";

const TEAM_NAME_MAX_LENGTH = 80;

/**
 * Starts a team from Plan. The team is its own space with its own plan: it
 * begins on Free, and the person who creates it owns and pays for it.
 */
export function CreateTeamDialog({
  session,
  apiBaseUrl,
  onSessionChange,
  onClose,
  onCreated,
}: {
  session: DesktopCloudSession;
  apiBaseUrl: string | null;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  onClose: () => void;
  onCreated: (team: DesktopCloudOrganization) => void;
}) {
  const { t } = useLocalization();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const title = t("settings.plan.space.createTeamTitle");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      onCreated(await createCloudTeam(session, trimmed, onSessionChange, apiBaseUrl));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("settings.plan.space.createTeamFailed"));
      setPending(false);
    }
  };

  return (
    <DesktopOverlayLayer>
      <DesktopDialogRoot onClose={pending ? undefined : onClose}>
        <DesktopDialogSurface width={420} ariaLabel={title}>
          <form onSubmit={(event) => void submit(event)}>
            <header className="desktop-dialog-header">
              <div className="desktop-dialog-title-row"><h2>{title}</h2></div>
              <Tooltip content={t("common.action.close")}><DesktopDialogCloseButton
                label={t("common.action.close")} disabled={pending} onClick={onClose} /></Tooltip>
            </header>
            <div className="desktop-dialog-body">
              <label className="desktop-dialog-field">
                <span>{t("settings.plan.space.teamName")}</span>
                <input
                  value={name}
                  maxLength={TEAM_NAME_MAX_LENGTH}
                  disabled={pending}
                  data-desktop-dialog-initial-focus="true"
                  onChange={(event) => {
                    setName(event.target.value);
                    setError(null);
                  }}
                />
              </label>
              <p className="desktop-dialog-note">{t("settings.plan.space.createTeamNote")}</p>
              {error && <p className="desktop-dialog-error" role="alert">{error}</p>}
            </div>
            <footer className="desktop-dialog-footer">
              <button className="desktop-dialog-button" type="button" disabled={pending} onClick={onClose}>
                {t("settings.plan.cancel")}
              </button>
              <button className="desktop-dialog-button primary" type="submit" disabled={pending || !trimmed}>
                {t("settings.plan.space.createTeam")}
              </button>
            </footer>
          </form>
        </DesktopDialogSurface>
      </DesktopDialogRoot>
    </DesktopOverlayLayer>
  );
}
