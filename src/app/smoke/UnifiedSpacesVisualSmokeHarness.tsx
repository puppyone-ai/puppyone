import { useState } from "react";
import { useLocalization } from "@puppyone/localization";
import { DesktopWindowChrome } from "../../components/DesktopWindowChrome";
import { WindowNavigationProvider } from "../../components/WindowNavigation";
import { SpaceSwitcher } from "../SpaceSwitcher";
import { PlanComparison } from "../../features/settings/main/CloudPlans";
import { resolvePlanCatalog, resolvePlanHolding } from "../../features/settings/main/planPricing";
import type { CloudSpace } from "../../lib/workspaceHomeModel";
import type { DesktopCloudSession } from "../../lib/cloudApi";
import "../space-navigation.css";

const SPACES: CloudSpace[] = [
  { id: "acme", name: "Acme Research", kind: "team", canCreateProjects: true, planId: "enterprise_v2" },
  { id: "mine", name: "My space", kind: "personal", canCreateProjects: true, planId: "team_v2" },
];
const SESSION = { user_id: "fixture", api_base_url: "https://fixture.invalid/api/v1" } as DesktopCloudSession;

/** Deterministic presentation only; opening and switching make no API request. */
export function UnifiedSpacesVisualSmokeHarness() {
  const localization = useLocalization();
  const { t } = localization;
  const [selected, setSelected] = useState<string | null>("acme");
  const [settings, setSettings] = useState(false);
  const space = SPACES.find((candidate) => candidate.id === selected);
  const catalog = resolvePlanCatalog(null);
  const navigation = <SpaceSwitcher spaces={SPACES} selectedId={selected} session={SESSION}
    apiBaseUrl={SESSION.api_base_url} onSessionChange={() => undefined} onCreated={() => undefined}
    onSelect={(id) => { setSelected(id); setSettings(false); }} onSettings={() => setSettings(true)} onInvite={() => setSettings(true)} />;
  return <WindowNavigationProvider value={navigation}>
    <DesktopWindowChrome />
    <main className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body">
        <div className="desktop-settings-section">
          <h1>{space?.name ?? t("settings.space.local")}</h1>
          <p>{settings ? t("settings.space.settings") : t("onboarding.projects.title")}</p>
          {space ? <>
            <p>{space.id === "acme" ? "Research · Hiring" : "Journal · Notes"}</p>
            {settings && <PlanComparison plans={catalog.plans} holding={resolvePlanHolding(null, null)} signedIn
              localization={localization} renderAction={(plan) => <span>{t(`settings.plan.name.${plan.id}`)}</span>} />}
          </> : <p>{t("onboarding.projects.localTitle")}</p>}
        </div>
      </div>
    </main>
  </WindowNavigationProvider>;
}
