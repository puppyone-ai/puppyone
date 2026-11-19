import { useEffect, useState } from "react";
import { useLocalization, type LocalizationContextValue } from "@puppyone/localization";
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
import { usePaymentsExperience } from "../../payments";
import { SettingsSectionHeader, SettingsSubsection, SettingsValueRow } from "../components";
import { AccountAICredits } from "./AccountAICredits";
import { AccountIdentity } from "./AccountIdentity";
import { formatMoney, heldPlanName, resolvePlanHolding, type PlanHolding } from "./planPricing";
import { useAccountPlan } from "./useAccountPlan";

type AccountAuthOperation = "signin" | "signout";

type Translate = (id: string, values?: Record<string, string | number>) => string;

/** Silence is the signed-in state. Only exceptions get a line of their own. */
function resolveStatusNote({ restoring, status, mismatched, t }: {
  restoring: boolean;
  status: DesktopCloudSession["status"] | undefined;
  mismatched: boolean;
  t: Translate;
}): string | null {
  if (restoring) return t("settings.account.status.restoring");
  if (status === "offline-authenticated") return t("settings.account.status.offline");
  if (status === "refreshing") return t("settings.account.status.refreshing");
  if (status === "signing-out") return t("settings.account.status.signingOut");
  if (mismatched) return t("settings.account.differentService");
  return null;
}

/**
 * Account.
 *
 * Identity and account AI credits, plus a compact reading of the current
 * Space's plan. The reading names its Space and links to Plan, which owns
 * usage, catalog prices and subscription changes.
 *
 * It deliberately does not use the label/value rows the rest of Settings uses
 * for the identity — those are for configuration, and an identity is not a
 * setting. A row reading "Status: Signed in" beside the email that already
 * proves it is pure restatement, so it is gone.
 */
export function AccountSettingsView({
  cloudSession,
  cloudSessionRestoring,
  cloudApiBaseUrl,
  onCloudSessionChange,
  cloudEnabled,
  organizationId = null,
  spaceName,
  onOpenBilling,
}: {
  cloudSession: DesktopCloudSession | null;
  cloudSessionRestoring: boolean;
  cloudApiBaseUrl: string | null;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
  organizationId?: string | null;
  spaceName?: string | null;
  /**
   * The Plan line and storage usage describe the Cloud Computer plan, so they
   * appear only with Cloud on. Identity and compute credit never wait for it.
   */
  cloudEnabled: boolean;
  /** Opens Billing. Absent while the payments experiment is off. */
  onOpenBilling?: () => void;
}) {
  const localization = useLocalization();
  const { t } = localization;
  /** Settings is a render entry for the payment fork; the leaves obey it. */
  const payments = usePaymentsExperience();
  const resolvedApiBaseUrl = cloudApiBaseUrl || getDesktopCloudApiBaseUrl();
  const [operation, setOperation] = useState<AccountAuthOperation | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const signedIn = Boolean(cloudSession);
  const sessionMatchesService = !cloudSession
    || isCloudSessionForApiBase(cloudSession, resolvedApiBaseUrl);
  const desktopOAuthAvailable = supportsDesktopCloudOAuth();
  const busy = Boolean(operation) || cloudSessionRestoring;

  const cloudPlan = payments && cloudEnabled && Boolean(organizationId);
  const snapshot = useAccountPlan({
    session: sessionMatchesService ? cloudSession : null,
    apiBaseUrl: resolvedApiBaseUrl,
    onSessionChange: onCloudSessionChange,
    enabled: cloudPlan && !cloudSessionRestoring,
    organizationId,
  });
  const holding = resolvePlanHolding(snapshot.summary, snapshot.catalog);
  let planDescription = describeHolding(holding, localization);
  if (cloudSessionRestoring || (cloudSession && !snapshot.summary)) {
    planDescription = snapshot.loading || cloudSessionRestoring ? t("settings.plan.loading") : "—";
  }
  // Only say something about the session when it is not simply working. The
  // steady signed-in state needs no commentary; the email is the proof.
  const statusNote = resolveStatusNote({
    restoring: cloudSessionRestoring,
    status: cloudSession?.status,
    mismatched: signedIn && !sessionMatchesService,
    t,
  });

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
          <SettingsSectionHeader title={t("settings.account.title")} />

          <AccountIdentity
            email={cloudSession?.user_email ?? null}
            statusNote={statusNote}
            busy={operation === "signout" || cloudSessionRestoring}
            onSignOut={() => void signOut()}
            cloudEnabled={cloudEnabled}
          />

          {!signedIn && (
            <div className="desktop-account-signin">
              <button
                type="button"
                className="desktop-settings-action primary"
                disabled={busy || !desktopOAuthAvailable}
                onClick={() => void startWebSignIn()}
              >
                {t(operation === "signin"
                  ? "settings.account.openingBrowser"
                  : "settings.account.signInWithBrowser")}
              </button>
            </div>
          )}

          {(authError || authMessage) && (
            <div className={`desktop-settings-account-feedback ${authError ? "danger" : "success"}`}>
              {authError ?? authMessage}
            </div>
          )}

          {/* The service mismatch is a real configuration fault, so it keeps an
              explicit readout rather than hiding behind the identity line. */}
          {!sessionMatchesService && (
            <SettingsSubsection title={t("settings.account.differentService")}>
              <SettingsValueRow
                label={t("settings.account.desktopService")}
                value={resolvedApiBaseUrl}
                monospace
              />
              <SettingsValueRow
                label={t("settings.account.sessionService")}
                value={cloudSession?.api_base_url ?? t("settings.account.none")}
                monospace={Boolean(cloudSession?.api_base_url)}
              />
            </SettingsSubsection>
          )}

          {cloudPlan && sessionMatchesService && (
            <SettingsSubsection leading>
              <SettingsValueRow
                label={t("settings.account.plan")}
                value={<>{spaceName && `${spaceName} · `}{planDescription}</>}
                action={onOpenBilling && <button type="button" className="desktop-settings-action" onClick={onOpenBilling}>
                  {t(holding.subscribed || (cloudSession && !snapshot.summary) ? "settings.account.openBilling" : "settings.account.upgrade")}
                </button>}
              />
            </SettingsSubsection>
          )}

          {sessionMatchesService && (
            <AccountAICredits
              key={cloudSession?.user_id ?? "signed-out"}
              payments={payments}
              // The balance belongs to the account, so it is topped up here, the
              // page the account button in every Header opens.
              topUp
              signedIn={signedIn
                && !cloudSessionRestoring
                && cloudSession?.status !== "signing-out"
                && operation !== "signout"}
              onSignIn={() => void startWebSignIn()}
              signInDisabled={busy || !desktopOAuthAvailable}
            />
          )}
        </div>
      </div>
    </section>
  );
}

/** An actual holding, never a locally assumed catalog price. */
function describeHolding(holding: PlanHolding, localization: LocalizationContextValue): string {
  const name = heldPlanName(holding, localization);
  if (!holding.subscribed || holding.monthlyCents === null) return name;
  return `${name} · ${localization.t("settings.plan.monthlyFor", {
    amount: formatMoney(holding.monthlyCents, holding.currency, localization),
  })}`;
}
