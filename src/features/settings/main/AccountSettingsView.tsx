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
import { AccountUsageMeters } from "./AccountUsageMeters";
import { formatMoney, resolvePlanHolding, type PlanHolding } from "./planPricing";
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
 * Who you are, what you run, what it costs you a month, and what is left of
 * what you bought. Every line is a statement of fact, and nothing on this page
 * changes what you pay — the one place that does is Billing, offered once, as
 * a link beside the figure it would change.
 *
 * That is a deliberately different line from the old "Account / Plan & Usage"
 * split, which failed because both pages answered *what you hold*: each ended
 * in a link to the other and neither was the answer. State and purchase is a
 * line a reader can keep: I am looking something up, or I am changing it.
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
  onOpenBilling,
  cloudEnabled,
}: {
  cloudSession: DesktopCloudSession | null;
  cloudSessionRestoring: boolean;
  cloudApiBaseUrl: string | null;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
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

  const cloudPlan = payments && cloudEnabled;
  const snapshot = useAccountPlan({
    session: sessionMatchesService ? cloudSession : null,
    apiBaseUrl: resolvedApiBaseUrl,
    onSessionChange: onCloudSessionChange,
    enabled: cloudPlan,
  });
  const holding = resolvePlanHolding(snapshot.summary, snapshot.catalog);

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
            <>
              <SettingsSubsection leading>
                {/* What you run and what it costs, in one line. The only way to
                    change it is offered here, once, beside the number it would
                    change — and this page states no catalogue price at all. */}
                <SettingsValueRow
                  label={t("settings.account.plan")}
                  value={describeHolding(holding, localization)}
                  action={onOpenBilling ? (
                    <button type="button" className="desktop-settings-action" onClick={onOpenBilling}>
                      {t(holding.subscribed ? "settings.account.openBilling" : "settings.account.upgrade")}
                    </button>
                  ) : undefined}
                />
                <p className="desktop-plan-note">{t("settings.account.localFreeNote")}</p>
              </SettingsSubsection>

              {/* A heading with nothing under it labels whatever comes next, so
                  usage appears only once there is usage to report. */}
              {signedIn && snapshot.usage && (
                <SettingsSubsection title={t("settings.account.usageTitle")}>
                  <AccountUsageMeters
                    usage={snapshot.usage}
                    catalog={snapshot.catalog}
                    planId={snapshot.summary?.plan_id ?? null}
                  />
                </SettingsSubsection>
              )}
            </>
          )}

          {sessionMatchesService && (
            <AccountAICredits
              key={cloudSession?.user_id ?? "signed-out"}
              payments={payments}
              // Without Cloud there is no Plan page, so Account is where compute is bought.
              topUp={!cloudEnabled}
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

/** What you hold and what it costs, in one line: a plan name is not an invoice. */
function describeHolding(
  holding: PlanHolding,
  localization: LocalizationContextValue,
): string {
  const { t } = localization;
  if (!holding.subscribed) return t("settings.plan.freePrice");
  const name = t("settings.seats.planName");
  if (holding.monthlyCents === null) return name;
  return `${name} · ${t("settings.plan.monthlyFor", {
    amount: formatMoney(holding.monthlyCents, holding.currency, localization),
  })}`;
}
