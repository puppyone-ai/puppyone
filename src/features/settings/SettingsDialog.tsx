import { useState } from "react";
import { Tooltip } from "@puppyone/shared-ui";
import { CreateTeamDialog } from "./main/CreateTeamDialog";
import { Settings } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../components/DesktopDialog";
import {
  createSettingsWorkspaceSurface,
  type SettingsWorkspaceSurfaceProps,
} from "./SettingsWorkspaceSurface";

export type SettingsDialogProps = SettingsWorkspaceSurfaceProps & {
  onClose: () => void;
};

/**
 * Settings is a temporary application task, not a Workspace destination.
 * Its existing navigation and content stay feature-owned while the dialog
 * shell preserves the Explorer, editors, and auxiliary sidebar underneath.
 */
export function SettingsDialog({ onClose, ...settings }: SettingsDialogProps) {
  const { t } = useLocalization();
  // Settings chooses a billing/management target without navigating the project underneath.
  const { cloud } = settings;
  const authority = cloud.session ? JSON.stringify([cloud.session.user_id,
    cloud.session.session_generation, cloud.apiBaseUrl]) : null;
  const [selection, setSelection] = useState<{ authority: string | null; id: string } | null>(null);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const spaces = cloud.session ? cloud.spaces : undefined;
  const selected = spaces?.find(space => space.id === (selection?.authority === authority ? selection?.id : cloud.spaceId))
    ?? spaces?.find(space => space.id === cloud.spaceId) ?? spaces?.[0];
  const managedCloud = spaces ? { ...cloud, spaceId: selected?.id ?? null, spaceName: selected?.name ?? null } : cloud;
  const surface = createSettingsWorkspaceSurface({ ...settings, cloud: managedCloud });
  const showSpacePicker = cloud.enabled && Boolean(cloud.session) && !cloud.sessionRestoring
    && (settings.activeSection === "seats" || settings.activeSection === "space");
  const title = t("shell.navigation.settings");

  return (
    <DesktopDialogRoot className="desktop-settings-dialog-backdrop" onClose={onClose}>
      <DesktopDialogSurface
        className="desktop-settings-dialog"
        width={960}
        ariaLabel={title}
      >
        <header className="desktop-dialog-header desktop-settings-dialog-header">
          <div className="desktop-dialog-title-row desktop-settings-dialog-title-row">
            <span className="desktop-settings-dialog-leading" aria-hidden="true">
              <Settings size={15} strokeWidth={1.9} />
            </span>
            <h2>{title}</h2>
          </div>
          <Tooltip content={t("common.action.close")}><DesktopDialogCloseButton label={t("common.action.close")} onClick={onClose} /></Tooltip>
        </header>

        <div className="desktop-settings-dialog-layout">
          <aside className="desktop-settings-dialog-navigation">
            {surface.sidebar}
          </aside>
          <main className="desktop-settings-dialog-content" data-space-picker={showSpacePicker || undefined}>
            {showSpacePicker && <div className="desktop-settings-space-picker">
              <label>
                <span>{t("settings.space.group")}</span>
                <select className="desktop-settings-select" aria-label={t("settings.space.switch")}
                  disabled={!spaces?.length} value={selected?.id ?? ""} onChange={event => setSelection({ authority, id: event.target.value })}>
                  {!spaces?.length && <option value="">{t("settings.space.group")}</option>}
                  {spaces?.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}
                </select>
              </label>
              <button type="button" className="desktop-settings-action" disabled={!cloud.apiBaseUrl}
                onClick={() => setCreatingFor(authority)}>{t("settings.space.create")}</button>
            </div>}
            {surface.main}
          </main>
        </div>
      </DesktopDialogSurface>
      {creatingFor !== null && creatingFor === authority && cloud.session && cloud.apiBaseUrl && <CreateTeamDialog key={authority}
        session={cloud.session} apiBaseUrl={cloud.apiBaseUrl} onSessionChange={cloud.onSessionChange}
        onClose={() => setCreatingFor(null)} onCreated={space => {
          setCreatingFor(null); setSelection({ authority, id: space.id }); cloud.onSpaceChange?.();
        }} />}
    </DesktopDialogRoot>
  );
}
