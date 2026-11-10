import { useLocalization } from "@puppyone/localization";
import {
  getDesktopCloudApiBaseUrl,
  isCloudSessionForApiBase,
  type DesktopCloudSession,
} from "../../../lib/cloudApi";
import { SettingsSectionHeader } from "../components";
import { SpaceSettings } from "./SpaceSettings";

/** Space configuration is available independently of the payments experiment. */
export function SpaceSettingsView({
  cloudSession,
  cloudSessionRestoring = false,
  organizationId,
  spaceName,
  cloudApiBaseUrl,
  onCloudSessionChange,
  onSpaceChange,
  onSignIn,
}: {
  cloudSession: DesktopCloudSession | null;
  cloudSessionRestoring?: boolean;
  organizationId?: string | null;
  spaceName?: string | null;
  cloudApiBaseUrl: string | null;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
  onSpaceChange?: () => void;
  onSignIn: () => void;
}) {
  const { t } = useLocalization();
  const apiBaseUrl = cloudApiBaseUrl || getDesktopCloudApiBaseUrl();
  const session = cloudSession && isCloudSessionForApiBase(cloudSession, apiBaseUrl)
    ? cloudSession : null;
  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section">
          <SettingsSectionHeader title={t("settings.space.settings")} />
          {cloudSessionRestoring && <p className="desktop-plan-note" role="status">{t("settings.account.status.restoring")}</p>}
          {!cloudSessionRestoring && !session && <button type="button" className="desktop-settings-action" onClick={onSignIn}>
              {t("settings.account.signInWithBrowser")}
            </button>}
          {!cloudSessionRestoring && session && <>
              <p className="desktop-plan-note">{organizationId ? spaceName : t("settings.space.choose")}</p>
              {organizationId && <SpaceSettings
                key={`${session.user_id}:${session.session_generation}:${apiBaseUrl}:${organizationId}`}
                session={session} organizationId={organizationId} name={spaceName ?? ""}
                apiBaseUrl={apiBaseUrl} onSessionChange={onCloudSessionChange}
                onChanged={() => onSpaceChange?.()} />}
            </>}
        </div>
      </div>
    </section>
  );
}
