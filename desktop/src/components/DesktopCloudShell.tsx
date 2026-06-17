import type { ReactNode } from "react";

export type DesktopView = "data" | "git" | "settings";

type DesktopCloudShellProps = {
  children: ReactNode;
};

export function DesktopCloudShell({ children }: DesktopCloudShellProps) {
  return (
    <div className="desktop-shell">
      <header className="desktop-titlebar" aria-hidden="true" />

      <div className="desktop-shell-body">
        <main className="desktop-surface">
          {children}
        </main>
      </div>
    </div>
  );
}
