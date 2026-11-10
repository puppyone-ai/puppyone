import { ArrowLeft, Check, LogIn, Plus, Settings, UserRound } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { LocalIcon } from "@puppyone/shared-ui";
import { DesktopMenuItem, DesktopMenuSeparator } from "../../../components/DesktopMenu";
import { useWindowNavigation, type WindowNavigation } from "../../../components/WindowNavigation";
import { useDesktopPlatformCapabilities } from "../../../platform";
import { SpaceMark, useSpaceName } from "../../cloud/spaces/SpaceMark";
import { useCloudAuthController } from "../../cloud";

/** This computer's key among the places; a Space's is its id. */
export const LOCAL_PLACE = "local";

export type WindowNavigationRowsProps = Readonly<{
  /** The place the window shows, marked among the others. */
  current?: string | null;
  /** Back to Home; absent on Home itself. */
  onHome?: () => void;
  onDismiss: () => void;
}>;

export function windowNavigationHasRows(navigation: WindowNavigation | null, onHome?: () => void) {
  return Boolean(onHome || navigation?.onShowPlace || navigation?.account);
}

/**
 * Two levels, Spaces and the folders in them: this menu is the Spaces. Home,
 * then every place with a way to start another Space, then the account.
 * A place opens on Home, scrolled to its folders: Home is the map, so folders
 * are moved between places there, and a place is never a mode the window
 * switches into.
 */
export function WindowNavigationRows({ current = null, onHome, onDismiss }: WindowNavigationRowsProps) {
  const { t } = useLocalization();
  const navigation = useWindowNavigation();
  const platform = useDesktopPlatformCapabilities();
  const spaceName = useSpaceName();
  const showPlace = navigation?.onShowPlace;
  const account = navigation?.account;
  const choose = (action: () => void) => () => { onDismiss(); action(); };
  const row = (place: string) => ({
    "data-window-place": place,
    "aria-current": place === current || undefined,
    trailing: place === current ? <Check size={14} aria-hidden="true" /> : undefined,
    onClick: choose(() => showPlace?.(place)),
  });
  const createSpace = account?.session ? account.onCreateSpace : undefined;
  const sections = [
    onHome && <DesktopMenuItem key="home" data-window-place="home"
      icon={<ArrowLeft className="po-directional-icon" size={15} />} label={t("shell.workspaceSwitcher.home")}
      onClick={choose(onHome)} />,
    showPlace && <div key="places" className="desktop-window-places" data-window-navigation="places">
      <DesktopMenuItem {...row(LOCAL_PLACE)}
        icon={<span className="desktop-window-place-mark" aria-hidden="true"><LocalIcon size={15} strokeWidth={1.75} /></span>}
        label={t(platform?.platform === "macos"
          ? "shell.workspaceSwitcher.location.thisMac"
          : "shell.workspaceSwitcher.location.thisComputer")} />
      {navigation.spaces.map((space) => <DesktopMenuItem key={space.id} {...row(space.id)}
        icon={<span className="desktop-window-place-mark" aria-hidden="true"><SpaceMark space={space} size="md" /></span>}
        label={<bdi>{spaceName(space)}</bdi>} />)}
      {createSpace && <DesktopMenuItem data-account-row="create-space" icon={<Plus size={15} />}
        label={t("settings.space.create")} onClick={choose(createSpace)} />}
    </div>,
    account && <div key="account" data-window-navigation="account">
      {account.session
        ? <>
          <DesktopMenuItem icon={<UserRound size={15} />} label={t("settings.sidebar.account")}
            data-account-row="account" onClick={choose(account.onOpenAccount)} />
          {account.onOpenSettings && <DesktopMenuItem icon={<Settings size={15} />} label={t("shell.navigation.settings")}
            data-account-row="settings" onClick={choose(account.onOpenSettings)} />}
        </>
        : <SignInRow apiBaseUrl={account.apiBaseUrl} onDismiss={onDismiss} />}
    </div>,
  ].filter(Boolean);
  return <>{sections.flatMap((section, index) => index
    ? [<DesktopMenuSeparator key={`separator-${index}`} />, section]
    : [section])}</>;
}

/** Signed out, the account's place asks to sign in, with its own sign-in flow. */
function SignInRow({ apiBaseUrl, onDismiss }: { apiBaseUrl: string; onDismiss: () => void }) {
  const { t } = useLocalization();
  const auth = useCloudAuthController({ cloudApiBaseUrl: apiBaseUrl });
  return <DesktopMenuItem icon={<LogIn size={15} />} label={t("cloud.auth.signIn")} data-account-row="sign-in"
    onClick={() => { onDismiss(); auth.startSignIn(); }} />;
}
