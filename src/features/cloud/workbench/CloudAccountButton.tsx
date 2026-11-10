import { useRef, useState } from "react";
import { LogIn, LogOut, Plus, Settings, UserRound } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { DesktopMenuItem, DesktopMenuSection, DesktopMenuSeparator } from "../../../components/DesktopMenu";
import { DesktopTitlebarMenuLayer } from "../../../components/DesktopTitlebarMenuLayer";
import type { WindowAccountMenu } from "../../../components/WindowNavigation";
import { useCloudAuthController } from "../hooks/useCloudAuthController";
import type { DesktopCloudSession } from "../../../lib/cloudApi";

type AccountActions = Omit<WindowAccountMenu, "session" | "apiBaseUrl">;

/**
 * Who is signed in, then Account (where the plan and the AI balance are topped
 * up), Settings, a new Space and Sign out.
 */
export function AccountMenuRows({ session, onOpenAccount, onOpenSettings, onCreateSpace, onSignOut, onDismiss, itemRole }: AccountActions & {
  session: DesktopCloudSession;
  onDismiss: () => void;
  /** Rows inside a dialog are buttons; inside a menu they are its items. */
  itemRole?: "button";
}) {
  const { t } = useLocalization();
  const choose = (action: () => void) => () => { onDismiss(); action(); };
  return <>
    <DesktopMenuSection label={<bdi className="desktop-account-menu-email">{session.user_email}</bdi>}>
      <DesktopMenuItem icon={<UserRound size={15} />} label={t("settings.sidebar.account")}
        data-account-row="account" role={itemRole} onClick={choose(onOpenAccount)} />
      {onOpenSettings && <DesktopMenuItem icon={<Settings size={15} />} label={t("shell.navigation.settings")}
        data-account-row="settings" role={itemRole} onClick={choose(onOpenSettings)} />}
      {onCreateSpace && <DesktopMenuItem icon={<Plus size={15} />} label={t("settings.space.create")}
        data-account-row="create-space" role={itemRole} onClick={choose(onCreateSpace)} />}
    </DesktopMenuSection>
    {onSignOut && <>
      <DesktopMenuSeparator />
      <DesktopMenuItem icon={<LogOut size={15} />} label={t("settings.account.signOut")}
        data-account-row="sign-out" role={itemRole} onClick={choose(onSignOut)} />
    </>}
  </>;
}

/** Signed out, the account's place in a menu asks to sign in, with its own sign-in flow. */
export function AccountSignInRow({ apiBaseUrl, onDismiss, itemRole }: { apiBaseUrl: string; onDismiss: () => void; itemRole?: "button" }) {
  const { t } = useLocalization();
  const auth = useCloudAuthController({ cloudApiBaseUrl: apiBaseUrl });
  return <DesktopMenuItem icon={<LogIn size={15} />} label={t("cloud.auth.signIn")} data-account-row="sign-in"
    role={itemRole} onClick={() => { onDismiss(); auth.startSignIn(); }} />;
}

/** "Sign in" at the trailing end of the Header while no account is signed in. */
export function HeaderSignInButton({ apiBaseUrl }: { apiBaseUrl: string }) {
  const auth = useCloudAuthController({ cloudApiBaseUrl: apiBaseUrl });
  return <SignInButton onSignIn={auth.startSignIn} />;
}

function SignInButton({ onSignIn }: { onSignIn: () => void }) {
  const { t } = useLocalization();
  // Stays available while waiting: asking again reopens the browser page.
  return <button type="button" className="desktop-titlebar-action homepage-cloud-sign-in"
    aria-label={t("cloud.auth.signInToCloud")} onClick={onSignIn}>
    {t("cloud.auth.signIn")}
  </button>;
}

/**
 * "Sign in" when signed out, otherwise the account's initial, which opens the
 * account's menu. Windows reach the account from the Header's leading menu; this
 * stands alone where there is no Header to hold it.
 */
export function CloudAccountButton({ session, onSignIn, ...actions }: AccountActions & {
  session: DesktopCloudSession | null;
  onSignIn: () => void;
}) {
  const { t } = useLocalization();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!session) return <SignInButton onSignIn={onSignIn} />;
  return <>
    <button type="button" ref={trigger} className="desktop-titlebar-action homepage-cloud-avatar"
      aria-label={`${t("settings.sidebar.account")}: ${session.user_email}`}
      aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span aria-hidden="true">{Array.from(session.user_email.trim())[0]?.toLocaleUpperCase() || "P"}</span>
    </button>
    <DesktopTitlebarMenuLayer anchorRef={trigger} className="desktop-account-menu" open={open}
      onDismiss={() => setOpen(false)} alignment="end" gap={4} preferredWidth={240} preferredMaxHeight={320}
      ariaLabel={t("settings.sidebar.account")} focusOnOpen>
      <AccountMenuRows session={session} {...actions} onDismiss={() => setOpen(false)} />
    </DesktopTitlebarMenuLayer>
  </>;
}
