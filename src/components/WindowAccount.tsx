import { createContext, useContext, type ReactNode } from "react";

/** The app-owned account control at the trailing end of every window surface's native chrome. */
const WindowAccount = createContext<ReactNode>(null);
export const WindowAccountProvider = WindowAccount.Provider;
export function useWindowAccount() { return useContext(WindowAccount); }
