import { useLocalization } from "@puppyone/localization";
import {
  getDesktopCloudApiBaseUrl,
  isCloudSessionForApiBase,
  type DesktopCloudSession,
} from "../../../lib/cloudApi";
import { usePaymentsExperience } from "../../payments";
import { SettingsSectionHeader } from "../components";
import { CloudPlans } from "./CloudPlans";
import { useAccountPlan } from "./useAccountPlan";

/** Plan and usage for the window's current Space. Members live in Space settings. */
export function SeatsSettingsView({
  cloudSession,
  cloudSessionRestoring = false,
  organizationId = null,
  spaceName,
  cloudApiBaseUrl,
  onCloudSessionChange,
  onSignIn,
  signInDisabled = false,
}: {
  cloudSession: DesktopCloudSession | null;
  cloudSessionRestoring?: boolean;
  organizationId?: string | null;
  spaceName?: string | null;
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
    enabled: payments && !cloudSessionRestoring,
    organizationId,
  });

  if (!payments) return null;

  return (
    <section className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body" data-po-scrollbar="content">
        <div className="desktop-settings-section desktop-plan-settings">
          <SettingsSectionHeader title={t("settings.seats.title")} />

          <p className="desktop-plan-note">{organizationId ? spaceName : t("settings.space.choose")}</p>
          <CloudPlans
            session={session}
            apiBaseUrl={resolvedApiBaseUrl}
            organizationId={snapshot.organizationId}
            onSessionChange={onCloudSessionChange}
            catalog={snapshot.catalog}
            summary={snapshot.summary}
            usage={snapshot.usage}
            loading={snapshot.loading}
            restoring={cloudSessionRestoring}
            loadError={snapshot.error}
            catalogUnavailable={snapshot.catalogUnavailable}
            onRefresh={snapshot.refresh}
            localization={localization}
            onSignIn={onSignIn}
            signInDisabled={signInDisabled}
            canManageBilling={snapshot.canManageBilling}
          />

          {/* The AI balance is the account's, topped up on Account; plans charge
              for the cloud and its agent time, never for the model's thinking. */}
        </div>
      </div>
    </section>
  );
}
