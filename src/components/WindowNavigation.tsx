import { createContext, useContext, type ReactNode } from "react";
import { CloudSignInDialog } from "../features/cloud";
import type { DesktopCloudSession } from "../lib/cloudApi";
import type { CloudSpace } from "../lib/workspaceHomeModel";

/** Who is signed in, and what the account itself can do. */
export type WindowAccountMenu = Readonly<{
  session: DesktopCloudSession | null;
  apiBaseUrl: string;
  onOpenAccount: () => void;
  onOpenSettings?: () => void;
  /** A Space belongs to the account that starts it, which owns and pays for it. */
  onCreateSpace?: () => void;
}>;

/**
 * What the Header's leading menu offers in every window: the places this
 * account reaches, each shown on Home, and the account. The window's trailing
 * end keeps the project's own tools only.
 */
export type WindowNavigation = Readonly<{
  account: WindowAccountMenu | null;
  spaces: readonly CloudSpace[];
  /** Home, with one place's projects in view: "local" for this computer, else a Space id. */
  onShowPlace?: (place: string) => void;
  /** The account at the Header's trailing end: Sign in, only while no one is signed in. */
  trailing?: ReactNode;
}>;

const WindowNavigationContext = createContext<WindowNavigation | null>(null);
export function WindowNavigationProvider({
  value,
  children,
}: {
  value: WindowNavigation | null;
  children: ReactNode;
}) {
  return (
    <WindowNavigationContext.Provider value={value}>
      {children}
      {value?.account && <CloudSignInDialog signedIn={Boolean(value.account.session)} />}
    </WindowNavigationContext.Provider>
  );
}
export function useWindowNavigation() { return useContext(WindowNavigationContext); }
