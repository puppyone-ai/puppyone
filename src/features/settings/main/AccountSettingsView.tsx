import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import {
  getDesktopCloudApiBaseUrl,
  isCloudSessionForApiBase,
  type DesktopCloudSession,
} from "../../../lib/cloudApi";
import {
  clearDesktopCloudSession,
  onDesktopCloudAuthError,
  startDesktopCloudOAuth,
  supportsDesktopCloudOAuth,
} from "../../../lib/cloudSession";
import { SettingsSectionHeader, SettingsSubsection, SettingsValueRow } from "../components";
import { AccountAICredits } from "./AccountAICredits";

type AccountAuthOperation = "signin" | "signout";

export function AccountSettingsView({
  cloudSession,
  cloudSessionRestoring,
  cloudApiBaseUrl,
  onCloudSessionChange,
}: {
  cloudSession: DesktopCloudSession | null;
  cloudSessionRestoring: boolean;
  cloudApiBaseUrl: string | null;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
}) {
  const { t } = useLocalization();
  const resolvedApiBaseUrl = cloudApiBaseUrl || getDesktopCloudApiBaseUrl();
  const [operation, setOperation] = useState<AccountAuthOperation | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const signedIn = Boolean(cloudSession);
  const accountStatus = cloudSessionRestoring
    ? t("settings.account.status.restoring")
    : cloudSession?.status === "offline-authenticated"
      ? t("settings.account.status.offline")
      : cloudSession?.status === "refreshing"
        ? t("settings.account.status.refreshing")
        : cloudSession?.status === "signing-out"
          ? t("settings.account.status.signingOut")
          : signedIn
            ? t("settings.account.status.signedIn")
            : t("settings.account.status.signedOut");
  const sessionMatchesService = !cloudSession || isCloudSessionForApiBase(cloudSession, resolvedApiBaseUrl);
  const desktopOAuthAvailable = supportsDesktopCloudOAuth();
  const busy = Boolean(operation) || cloudSessionRestoring;

  useEffect(() => onDesktopCloudAuthError((message) => {
    setOperation(null);
    setAuthMessage(null);
    setAuthError(message);
  }), []);

  useEffect(() => {
    if (!cloudSession) return;
    setOperation((current) => current === "signin" ? null : current);
    setAuthError(null);
    setAuthMessage(null);
  }, [cloudSession]);

  const startWebSignIn = async () => {
    if (!desktopOAuthAvailable) {
      setAuthMessage(null);
      setAuthError(t("settings.account.error.oauthUnavailable"));
      return;
    }
    setOperation("signin");
    setAuthError(null);
    setAuthMessage(null);
    try {
      await startDesktopCloudOAuth(resolvedApiBaseUrl);
      setAuthMessage(t("settings.account.message.finishInBrowser"));
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : t("settings.account.error.signInStart"));
    } finally {
      window.setTimeout(() => setOperation((current) => current === "signin" ? null : current), 1200);
    }
  };

  const signOut = async () => {
    if (operation === "signout") return;
    setOperation("signout");
    setAuthError(null);
    setAuthMessage(null);
    try {
      await clearDesktopCloudSession();
      onCloudSessionChange(null);
      setAuthMessage(t("settings.account.message.signedOut"));
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : t("settings.account.error.signOut"));
    } finally {
      setOperation(null);
    }
  };

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section desktop-account-settings-section">
          <SettingsSectionHeader title={t("settings.account.title")} detail={t("settings.account.detail")} />
          <SettingsSubsection>
            <SettingsValueRow
              label={t("settings.account.statusLabel")}
              value={accountStatus}
              tone={signedIn ? "success" : undefined}
              action={signedIn && !sessionMatchesService ? (
                <span className="desktop-settings-badge warning">{t("settings.account.differentService")}</span>
              ) : undefined}
            />
            <SettingsValueRow
              label={t("settings.account.email")}
              value={cloudSession?.user_email ?? t("settings.account.notSignedIn")}
            />
            {!sessionMatchesService && <><SettingsValueRow
              label={t("settings.account.desktopService")}
              value={resolvedApiBaseUrl}
              title={resolvedApiBaseUrl}
              monospace
            />
            <SettingsValueRow
              label={t("settings.account.sessionService")}
              value={cloudSession?.api_base_url ?? t("settings.account.none")}
              title={cloudSession?.api_base_url}
              monospace={Boolean(cloudSession?.api_base_url)}
            /></>}
            {signedIn && <div className="desktop-settings-row desktop-settings-row-control desktop-settings-account-actions-row">
              <span>{t("settings.account.authentication")}</span>
              <div className="desktop-settings-value desktop-settings-account-actions">
                  <button
                    className="desktop-settings-action danger"
                    type="button"
                    disabled={operation === "signout" || cloudSessionRestoring}
                    onClick={() => void signOut()}
                  >
                    <LogOut size={14} />
                    <span>{t(operation === "signout" ? "settings.account.signingOut" : "settings.account.signOut")}</span>
                  </button>
              </div>
            </div>}
            {(authError || authMessage) && (
              <div className={`desktop-settings-account-feedback ${authError ? "danger" : "success"}`}>
                {authError ?? authMessage}
              </div>
            )}
          </SettingsSubsection>
        </div>
        {sessionMatchesService && <AccountAICredits key={cloudSession?.user_id ?? "signed-out"}
          onSignIn={() => void startWebSignIn()} signInDisabled={busy || !desktopOAuthAvailable} />}
      </div>
    </section>
  );
}
