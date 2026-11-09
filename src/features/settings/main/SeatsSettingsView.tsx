import { useState } from "react";
import { useLocalization } from "@puppyone/localization";
import {
  getDesktopCloudApiBaseUrl,
  isCloudSessionForApiBase,
  type DesktopCloudSession,
} from "../../../lib/cloudApi";
import { usePaymentsExperience } from "../../payments";
import { SettingsSectionHeader } from "../components";
import { CloudPlans, OrganizationSwitch } from "./CloudPlans";
import { CreateTeamDialog } from "./CreateTeamDialog";
import { useAccountPlan } from "./useAccountPlan";

/**
 * Plan.
 *
 * Account answers who you are. This page answers what you are on, how much of
 * it you have used this period, and what else you could be on: Free, Personal
 * or Team, side by side, then the add-ons. See `planPricing.ts` for what is
 * sold and `CloudPlans.tsx` for how the page reads.
 *
 * It is built from the same rows as every other Settings page. The one thing
 * of its own is the three-plan comparison, which is the only honest way to
 * show a choice between three things.
 *
 * Invoices, payment methods and cancellation stay in the payment provider's
 * browser portal; the page offers one link out and keeps no history of its own.
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

  const [creatingTeam, setCreatingTeam] = useState(false);
  const snapshot = useAccountPlan({
    session,
    apiBaseUrl: resolvedApiBaseUrl,
    onSessionChange: onCloudSessionChange,
    enabled: payments,
  });

  // This surface exists only to ask for money. With the experiment off it must
  // not render a single price, even if something routes here by mistake.
  if (!payments) return null;

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section">
          <SettingsSectionHeader title={t("settings.seats.title")} />

          <OrganizationSwitch
            organizations={snapshot.organizations}
            selectedId={snapshot.organizationId}
            onSelect={snapshot.selectOrganization}
            localization={localization}
          />
          <CloudPlans
            session={session}
            apiBaseUrl={resolvedApiBaseUrl}
            organizationId={snapshot.organizationId}
            onSessionChange={onCloudSessionChange}
            catalog={snapshot.catalog}
            summary={snapshot.summary}
            usage={snapshot.usage}
            loading={snapshot.loading}
            onRefresh={snapshot.refresh}
            localization={localization}
            onSignIn={onSignIn}
            signInDisabled={signInDisabled}
            spaceKind={snapshot.organizations.find((organization) => organization.id === snapshot.organizationId)
              ?.personal === false ? "team" : "personal"}
            canManageBilling={snapshot.canManageBilling}
            onCreateTeam={session ? () => setCreatingTeam(true) : undefined}
          />
          {creatingTeam && session && (
            <CreateTeamDialog
              session={session}
              apiBaseUrl={resolvedApiBaseUrl}
              onSessionChange={onCloudSessionChange}
              onClose={() => setCreatingTeam(false)}
              onCreated={(team) => {
                setCreatingTeam(false);
                snapshot.selectOrganization(team.id);
                snapshot.refresh();
              }}
            />
          )}

          {/* The AI balance is the account's, topped up on Account; plans charge
              for the cloud and its agent time, never for the model's thinking. */}
        </div>
      </div>
    </section>
  );
}
