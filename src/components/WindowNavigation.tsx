import { createContext, useContext, type ReactNode } from "react";

/** App-owned navigation shared by the native chrome of every window surface. */
const WindowNavigation = createContext<ReactNode>(null);
export const WindowNavigationProvider = WindowNavigation.Provider;
export function WindowNavigationSlot() { return useContext(WindowNavigation); }

/** Cloud context belongs at the bottom of the active Sidebar, independently of Account. */
const SidebarSpaceNavigation = createContext<{ content: ReactNode; inProjectRail: boolean } | null>(null);
export const SidebarSpaceNavigationProvider = SidebarSpaceNavigation.Provider;
export function useSidebarSpaceNavigation(placement: "sidebar" | "rail" | "home" = "sidebar") {
  const navigation = useContext(SidebarSpaceNavigation);
  if (!navigation || (placement === "rail" && !navigation.inProjectRail)
    || (placement === "sidebar" && navigation.inProjectRail)) return null;
  return navigation.content;
}
