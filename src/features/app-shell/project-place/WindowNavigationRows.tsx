import { ArrowLeft, Check } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { LocalIcon } from "@puppyone/shared-ui";
import { DesktopMenuItem, DesktopMenuSection, DesktopMenuSeparator } from "../../../components/DesktopMenu";
import { useWindowNavigation, type WindowNavigation } from "../../../components/WindowNavigation";
import { useDesktopPlatformCapabilities } from "../../../platform";
import { SpaceMark, useSpaceName } from "../../cloud/spaces/SpaceMark";
import { AccountMenuRows, AccountSignInRow } from "../../cloud/workbench/CloudAccountButton";

/** This computer's key among the places; a Space's is its id. */
export const LOCAL_PLACE = "local";

export type WindowNavigationRowsProps = Readonly<{
  /** The place the window shows, marked among the others. */
  current?: string | null;
  /** Back to Home; absent on Home itself. */
  onHome?: () => void;
  onDismiss: () => void;
  /** Rows inside a dialog are buttons; inside a menu they are its items. */
  itemRole?: "button";
}>;

export function windowNavigationHasRows(navigation: WindowNavigation | null, onHome?: () => void) {
  return Boolean(onHome || navigation?.onShowPlace || navigation?.account);
}

/**
 * Where else the window can go, then who is signed in. Every place opens on
 * Home, scrolled to its projects: Home is the map, so projects are moved
 * between places there, and a place is never a mode the window switches into.
 */
export function WindowNavigationRows({ current = null, onHome, onDismiss, itemRole }: WindowNavigationRowsProps) {
  const { t } = useLocalization();
  const navigation = useWindowNavigation();
  const platform = useDesktopPlatformCapabilities();
  const spaceName = useSpaceName();
  const showPlace = navigation?.onShowPlace;
  const account = navigation?.account;
  const hasPlaces = Boolean(onHome || showPlace);
  const row = (place: string) => ({
    role: itemRole,
    "data-window-place": place,
    "aria-current": place === current || undefined,
    selected: place === current,
    trailing: place === current ? <Check size={14} aria-hidden="true" /> : undefined,
    onClick: () => { onDismiss(); showPlace?.(place); },
  });
  return <>
    {hasPlaces && <DesktopMenuSection label={t("shell.placeMenu.places")} data-window-navigation="places">
      {onHome && <DesktopMenuItem role={itemRole} data-window-place="home"
        icon={<ArrowLeft className="po-directional-icon" size={15} />} label={t("shell.workspaceSwitcher.home")}
        onClick={() => { onDismiss(); onHome(); }} />}
      {showPlace && <>
        <DesktopMenuItem {...row(LOCAL_PLACE)}
          icon={<span className="desktop-window-place-mark" aria-hidden="true"><LocalIcon size={15} strokeWidth={1.75} /></span>}
          label={t(platform?.platform === "macos"
            ? "shell.workspaceSwitcher.location.thisMac"
            : "shell.workspaceSwitcher.location.thisComputer")} />
        {navigation.spaces.map((space) => <DesktopMenuItem key={space.id} {...row(space.id)}
          icon={<span className="desktop-window-place-mark" aria-hidden="true"><SpaceMark space={space} size="md" /></span>}
          label={<bdi>{spaceName(space)}</bdi>} />)}
      </>}
    </DesktopMenuSection>}
    {account && <>
      {hasPlaces && <DesktopMenuSeparator />}
      {account.session
        ? <AccountMenuRows session={account.session} onOpenAccount={account.onOpenAccount}
          onOpenSettings={account.onOpenSettings} onCreateSpace={account.onCreateSpace}
          onSignOut={account.onSignOut} onDismiss={onDismiss} itemRole={itemRole} />
        : <AccountSignInRow apiBaseUrl={account.apiBaseUrl} onDismiss={onDismiss} itemRole={itemRole} />}
    </>}
  </>;
}
