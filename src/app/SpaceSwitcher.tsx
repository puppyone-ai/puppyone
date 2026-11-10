import { useEffect, useId, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import { Check, ChevronUp, Layers, Plus, Settings, UserPlus } from "lucide-react";
import { DesktopMenuItem, DesktopMenuSeparator } from "../components/DesktopMenu";
import { DesktopTitlebarMenuLayer } from "../components/DesktopTitlebarMenuLayer";
import { walkDesktopMenu } from "../components/desktopMenuKeyboard";
import type { CloudSpace } from "../lib/workspaceHomeModel";
import type { DesktopCloudSession } from "../lib/cloudApi";
import { CreateTeamDialog } from "../features/settings/main/CreateTeamDialog";

/** Navigation, not a settings preference: one choice drives every Space surface. */
export function SpaceSwitcher({ spaces, selectedId, session, apiBaseUrl, onSelect, onCreated, onSessionChange, onSettings, onInvite }: {
  spaces: readonly CloudSpace[]; selectedId: string | null; session: DesktopCloudSession;
  apiBaseUrl: string; onSelect: (id: string | null) => void; onCreated: (id: string) => void;
  onSessionChange: (session: DesktopCloudSession | null) => void; onSettings: () => void;
  onInvite: () => void;
}) {
  const { t } = useLocalization();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => { setOpen(false); }, [selectedId]);
  const space = spaces.find((candidate) => candidate.id === selectedId);
  const select = (id: string | null) => { setOpen(false); trigger.current?.focus(); onSelect(id); };
  const runAction = (action: () => void) => { setOpen(false); trigger.current?.focus(); action(); };
  return <div className="desktop-space-switcher" data-window-no-drag="true">
    <button ref={trigger} type="button" className="desktop-space-trigger po-sidebar-row"
      disabled={spaces.length === 0}
      aria-label={`${t("settings.space.switch")}: ${space?.name ?? t("settings.space.group")}`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      data-current-space={selectedId ?? ""} onClick={() => setOpen((value) => !value)}
      onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}>
      <Layers size={16} aria-hidden="true" /><bdi>{space?.name ?? t("settings.space.group")}</bdi><ChevronUp size={12} aria-hidden="true" />
    </button>
    <DesktopTitlebarMenuLayer anchorRef={trigger} open={open} onDismiss={() => setOpen(false)}
      className="desktop-space-menu" preferredMaxHeight={480} preferredWidth={260}
      placementPreference="above"
      id={menuId} ariaLabel={t("settings.space.switch")} focusOnOpen
      onKeyDown={(event) => walkDesktopMenu(event, event.currentTarget)}>
      {spaces.map((candidate) => <DesktopMenuItem
        key={candidate.id} role="menuitemradio" aria-checked={candidate.id === selectedId}
        data-space-id={candidate.id} label={<bdi>{candidate.name}</bdi>}
        trailing={candidate.id === selectedId ? <Check size={14} aria-hidden="true" /> : undefined}
        onClick={() => select(candidate.id)} />)}
      <DesktopMenuSeparator />
      {space && <>
        <DesktopMenuItem icon={<UserPlus size={14} />} label={t("settings.space.invite")}
          disabled={space.canManageSpace !== true} data-space-action="invite" onClick={() => runAction(onInvite)} />
        <DesktopMenuItem icon={<Settings size={14} />} label={t("settings.space.settings")}
          data-space-action="settings" onClick={() => runAction(onSettings)} />
      </>}
      <DesktopMenuItem icon={<Plus size={14} />} label={t("settings.space.create")}
        data-space-action="create" onClick={() => runAction(() => setCreating(true))} />
    </DesktopTitlebarMenuLayer>
    {creating && <CreateTeamDialog session={session} apiBaseUrl={apiBaseUrl} onSessionChange={onSessionChange}
      onClose={() => setCreating(false)} onCreated={(space) => { setCreating(false); onCreated(space.id); }} />}
  </div>;
}
