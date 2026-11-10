import { useState } from "react";
import { useLocalization } from "@puppyone/localization";
import { DesktopWindowChrome } from "../../components/DesktopWindowChrome";
import { WindowNavigationProvider } from "../../components/WindowNavigation";
import { PlanComparison } from "../../features/settings/main/CloudPlans";
import { resolvePlanCatalog, resolvePlanHolding } from "../../features/settings/main/planPricing";
import type { CloudSpace } from "../../lib/workspaceHomeModel";
import "../space-navigation.css";

const SPACES: CloudSpace[] = [
  { id: "acme", name: "Acme Research", kind: "space", canCreateProjects: true, planId: "enterprise_v2" },
  { id: "mine", name: "My space", kind: "space", canCreateProjects: true, planId: "team_v2" },
];
/** Deterministic presentation only; opening and switching make no API request. */
export function UnifiedSpacesVisualSmokeHarness() {
  const localization = useLocalization();
  const { t } = localization;
  const [selected, setSelected] = useState<string | null>("acme");
  const [settings, setSettings] = useState(false);
  const space = SPACES.find((candidate) => candidate.id === selected);
  const catalog = resolvePlanCatalog(null);
  return <WindowNavigationProvider value={null}>
    <DesktopWindowChrome />
    <main className="desktop-utility-view desktop-settings-view">
      <div className="desktop-utility-body desktop-settings-body">
        <div className="desktop-settings-section">
          {!settings && SPACES.map(item => <section key={item.id}>
            <h2>{item.name}</h2><p>{item.id === "acme" ? "Research · Hiring" : "Journal · Notes"}</p>
            <button onClick={() => { setSelected(item.id); setSettings(true); }}>{t("settings.seats.title")}</button>
          </section>)}
          {settings && <select aria-label={t("settings.space.switch")} value={selected ?? ""} onChange={event => setSelected(event.target.value)}>
            {SPACES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>}
          <p>{settings ? t("settings.space.settings") : t("onboarding.projects.title")}</p>
          {settings && space ? <>
            <p>{space.id === "acme" ? "Research · Hiring" : "Journal · Notes"}</p>
            {settings && <PlanComparison plans={catalog.plans} holding={resolvePlanHolding(null, null)} signedIn
              localization={localization} renderAction={(plan) => <span>{t(`settings.plan.name.${plan.id}`)}</span>} />}
          </> : <p>{t("onboarding.projects.localTitle")}</p>}
        </div>
      </div>
    </main>
  </WindowNavigationProvider>;
}
