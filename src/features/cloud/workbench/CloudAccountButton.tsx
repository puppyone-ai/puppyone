import { useRef, useState } from "react";
import { LogOut, Plus, Settings, UserRound } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { DesktopMenuItem, DesktopMenuSection, DesktopMenuSeparator } from "../../../components/DesktopMenu";
import { DesktopTitlebarMenuLayer } from "../../../components/DesktopTitlebarMenuLayer";
import { useCloudAuthController } from "../hooks/useCloudAuthController";
import type { DesktopCloudSession } from "../../../lib/cloudApi";

/**
 * The account at the trailing end of the Header: "Sign in" when signed out,
 * otherwise the account's initial, which opens a menu naming who is signed in,
 * with Account (where the plan and the AI balance are topped up), Settings, a new
 * Space and Sign out. The same control on the Homepage and inside every project.
 */
export function CloudAccountButton({ session, onSignIn, onOpenAccount, onOpenSettings, onCreateSpace, onSignOut }: {
  session: DesktopCloudSession | null;
  onSignIn: () => void;
  onOpenAccount: () => void;
  onOpenSettings?: () => void;
  /** A Space belongs to the account that starts it, which owns and pays for it. */
  onCreateSpace?: () => void;
  onSignOut?: () => void;
}) {
  const { t } = useLocalization();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (session) {
    const choose = (action: () => void) => () => { setOpen(false); action(); };
    return <>
      <button type="button" ref={trigger} className="desktop-titlebar-action homepage-cloud-avatar"
        aria-label={`${t("settings.sidebar.account")}: ${session.user_email}`}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span aria-hidden="true">{Array.from(session.user_email.trim())[0]?.toLocaleUpperCase() || "P"}</span>
      </button>
      <DesktopTitlebarMenuLayer anchorRef={trigger} className="desktop-account-menu" open={open}
        onDismiss={() => setOpen(false)} alignment="end" gap={4} preferredWidth={240} preferredMaxHeight={320}
        ariaLabel={t("settings.sidebar.account")} focusOnOpen>
        <DesktopMenuSection label={<bdi className="desktop-account-menu-email">{session.user_email}</bdi>}>
          <DesktopMenuItem icon={<UserRound size={15} />} label={t("settings.sidebar.account")}
            onClick={choose(onOpenAccount)} />
          {onOpenSettings && <DesktopMenuItem icon={<Settings size={15} />} label={t("shell.navigation.settings")}
            onClick={choose(onOpenSettings)} />}
        </DesktopMenuSection>
        {onCreateSpace && <>
          <DesktopMenuSeparator />
          <DesktopMenuItem icon={<Plus size={15} />} label={t("settings.space.create")}
            onClick={choose(onCreateSpace)} />
        </>}
        {onSignOut && <>
          <DesktopMenuSeparator />
          <DesktopMenuItem icon={<LogOut size={15} />} label={t("settings.account.signOut")}
            onClick={choose(onSignOut)} />
        </>}
      </DesktopTitlebarMenuLayer>
    </>;
  }
  // Stays available while waiting: asking again reopens the browser page.
  return <button type="button" className="desktop-titlebar-action homepage-cloud-sign-in"
    aria-label={t("cloud.auth.signInToCloud")} onClick={onSignIn}>
    {t("cloud.auth.signIn")}
  </button>;
}

/** The Header's account control, with its own sign-in flow. */
export function ProjectHeaderAccount({ session, apiBaseUrl, onOpenAccount, onOpenSettings, onCreateSpace, onSignOut }: {
  session: DesktopCloudSession | null;
  apiBaseUrl: string;
  onOpenAccount: () => void;
  onOpenSettings?: () => void;
  onCreateSpace?: () => void;
  onSignOut?: () => void;
}) {
  const auth = useCloudAuthController({ cloudApiBaseUrl: apiBaseUrl });
  return <CloudAccountButton session={session} onSignIn={auth.startSignIn} onOpenAccount={onOpenAccount}
    onOpenSettings={onOpenSettings} onCreateSpace={onCreateSpace} onSignOut={onSignOut} />;
}
