import type { DataPort } from "@puppyone/shared-ui";
import type { DesktopBridge } from "../../../support/electron/desktopBridge";

declare global {
  interface Window {
    resourceSmoke: {
      config(): Promise<{ workspacePath: string }>;
      read: NonNullable<DataPort["readFile"]>;
      persist: NonNullable<DataPort["documentPersistence"]>["persist"];
      record(entry: Record<string, unknown>): void;
    };
  }
}

export function requireResourceSmokeBridge(): Pick<DesktopBridge, "getPathForFile"> {
  const bridge = window.puppyoneDesktop;
  if (!bridge?.getPathForFile) throw new Error("Native resource smoke preload was not installed");
  return bridge;
}
