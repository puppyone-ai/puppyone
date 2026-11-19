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
  personal = false,
  cloudApiBaseUrl,
  onCloudSessionChange,
  onSpaceChange,
  onSignIn,
  focusInvite = false,
}: {
  cloudSession: DesktopCloudSession | null;
  cloudSessionRestoring?: boolean;
  organizationId?: string | null;
  spaceName?: string | null;
  /** The account's own Space: always "Personal", never renamed. */
  personal?: boolean;
  cloudApiBaseUrl: string | null;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
  onSpaceChange?: () => void;
  onSignIn: () => void;
  focusInvite?: boolean;
}) {
  const { t } = useLocalization();
  const apiBaseUrl = cloudApiBaseUrl || getDesktopCloudApiBaseUrl();
  const session = cloudSession && isCloudSessionForApiBase(cloudSession, apiBaseUrl)
    ? cloudSession : null;
  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section">
          <SettingsSectionHeader title={t("settings.space.membersAndSettings")} />
          {cloudSessionRestoring && <p className="desktop-plan-note" role="status">{t("settings.account.status.restoring")}</p>}
          {!cloudSessionRestoring && !session && <button type="button" className="desktop-settings-action" onClick={onSignIn}>
              {t("settings.account.signInWithBrowser")}
            </button>}
          {!cloudSessionRestoring && session && <>
              {!organizationId && <p className="desktop-plan-note">{t("settings.space.choose")}</p>}
              {organizationId && <SpaceSettings
                key={`${session.user_id}:${session.session_generation}:${apiBaseUrl}:${organizationId}`}
                session={session} organizationId={organizationId} name={spaceName ?? ""} personal={personal}
                apiBaseUrl={apiBaseUrl} onSessionChange={onCloudSessionChange}
                focusInvite={focusInvite}
                onChanged={() => onSpaceChange?.()} />}
            </>}
        </div>
      </div>
    </section>
  );
}
