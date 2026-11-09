import { useState } from "react";
import { useLocalization } from "@puppyone/localization";
import type { CloudSpace } from "../lib/workspaceHomeModel";
import type { DesktopCloudSession } from "../lib/cloudApi";
import { CreateTeamDialog } from "../features/settings/main/CreateTeamDialog";

/** Navigation, not a settings preference: one choice drives every Space surface. */
export function SpaceSwitcher({ spaces, selectedId, session, apiBaseUrl, onSelect, onCreated, onSessionChange, onSettings }: {
  spaces: readonly CloudSpace[]; selectedId: string | null; session: DesktopCloudSession;
  apiBaseUrl: string; onSelect: (id: string | null) => void; onCreated: (id: string) => void;
  onSessionChange: (session: DesktopCloudSession | null) => void; onSettings: () => void;
}) {
  const { t } = useLocalization();
  const [creating, setCreating] = useState(false);
  return <div className="desktop-space-switcher" data-window-no-drag="true">
    <select aria-label={t("settings.space.switch")} value={selectedId ?? "local"}
      onChange={(event) => {
        if (event.target.value === "create") setCreating(true);
        else if (event.target.value === "settings") onSettings();
        else onSelect(event.target.value === "local" ? null : event.target.value);
      }}>
      <option value="local">{t("settings.space.local")}</option>
      {spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
      <option value="settings">{t("settings.space.settings")}</option>
      <option value="create">{t("settings.space.create")}</option>
    </select>
    {creating && <CreateTeamDialog session={session} apiBaseUrl={apiBaseUrl} onSessionChange={onSessionChange}
      onClose={() => setCreating(false)} onCreated={(space) => { setCreating(false); onCreated(space.id); }} />}
  </div>;
}
