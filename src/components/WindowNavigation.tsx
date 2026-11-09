import { createContext, useContext, type ReactNode } from "react";

/** App-owned navigation shared by the native chrome of every window surface. */
const WindowNavigation = createContext<ReactNode>(null);
export const WindowNavigationProvider = WindowNavigation.Provider;
export function WindowNavigationSlot() { return useContext(WindowNavigation); }
