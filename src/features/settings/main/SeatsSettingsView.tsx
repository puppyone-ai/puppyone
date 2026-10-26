import { useLocalization } from "@puppyone/localization";
import {
  getDesktopCloudApiBaseUrl,
  isCloudSessionForApiBase,
  type DesktopCloudSession,
} from "../../../lib/cloudApi";
import { usePaymentsExperience } from "../../payments";
import { SettingsSectionHeader } from "../components";
import { AccountAICredits } from "./AccountAICredits";
import { PersonalPlan } from "./PersonalPlan";
import { resolvePersonalOffer, resolvePlanHolding } from "./planPricing";
import { useAccountPlan } from "./useAccountPlan";

/**
 * Plan.
 *
 * Account answers who you are. This page answers what you pay, what you get
 * for it and how much of the storage you have used. The product is priced per
 * person: one plan, Personal, which includes Storage and a Cloud Computer. See
 * `planPricing.ts` for what is sold and why the machine behind the Cloud
 * Computer is never described.
 *
 * It is built from the same rows as every other Settings page on purpose: a
 * pricing card with its own type sizes and sentences read as an advert inside
 * Settings.
 *
 * An earlier version priced cloud agents one at a time and led with a table of
 * projects saying how many agents each could run at once. With one plan per
 * person there is no per-project capacity left to explain, so the table is
 * gone and the plan card leads.
 *
 * Invoices and payment methods are not here. They are a browser surface, so
 * the card offers one link out and states no history of its own.
 *
 * `payments` is read here as a render entry and handed down: see
 * `src/features/payments/README.md`.
 */
export function SeatsSettingsView({
  cloudSession,
  cloudApiBaseUrl,
  onCloudSessionChange,
  onSignIn,
  signInDisabled = false,
}: {
  cloudSession: DesktopCloudSession | null;
  cloudApiBaseUrl: string | null;
  onCloudSessionChange: (session: DesktopCloudSession | null) => void;
  /** Buying needs an account, so the page offers the same sign-in Account does. */
  onSignIn: () => void;
  signInDisabled?: boolean;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const payments = usePaymentsExperience();
  const resolvedApiBaseUrl = cloudApiBaseUrl || getDesktopCloudApiBaseUrl();
  const sessionMatchesService = !cloudSession
    || isCloudSessionForApiBase(cloudSession, resolvedApiBaseUrl);
  const session = sessionMatchesService ? cloudSession : null;

  const snapshot = useAccountPlan({
    session,
    apiBaseUrl: resolvedApiBaseUrl,
    onSessionChange: onCloudSessionChange,
    enabled: payments,
  });
  const holding = resolvePlanHolding(snapshot.summary, snapshot.catalog);
  const { offer } = resolvePersonalOffer(snapshot.catalog);

  // This surface exists only to ask for money. With the experiment off it must
  // not render a single price, even if something routes here by mistake.
  if (!payments) return null;

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section">
          <SettingsSectionHeader title={t("settings.seats.title")} />

          <PersonalPlan
            session={session}
            apiBaseUrl={resolvedApiBaseUrl}
            organizationId={snapshot.organizationId}
            onSessionChange={onCloudSessionChange}
            offer={offer}
            holding={holding}
            usage={snapshot.usage}
            loading={snapshot.loading}
            localization={localization}
            onSignIn={onSignIn}
            signInDisabled={signInDisabled}
          />

          {/* The model is the user's own, and saying so is the point: the plan
              charges for the desk, never for the thinking done at it. */}
          <AccountAICredits
            key={cloudSession?.user_id ?? "signed-out"}
            payments={payments}
            signedIn={Boolean(session)}
            topUp
            title={t("settings.seats.creditsTitle")}
          />
        </div>
      </div>
    </section>
  );
}
