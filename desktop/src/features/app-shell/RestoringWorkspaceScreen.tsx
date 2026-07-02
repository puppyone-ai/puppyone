import type { ThemeMode } from "../../preferences";

const puppyoneLogoUrl = new URL("../../../public/puppyone-logo.svg", import.meta.url).href;

type RestoringWorkspaceScreenProps = {
  themeMode: ThemeMode;
  resolvedTheme: "light" | "dark";
};

export function RestoringWorkspaceScreen({
  themeMode,
  resolvedTheme,
}: RestoringWorkspaceScreenProps) {
  return (
    <main
      className={`onboarding-shell ${resolvedTheme === "dark" ? "dark" : ""}`}
      data-theme-mode={themeMode}
    >
      <div className="onboarding-titlebar" aria-hidden="true" />
      <section className="onboarding-panel onboarding-panel-compact" aria-label="Opening workspace">
        <div className="onboarding-brand">
          <img src={puppyoneLogoUrl} alt="" className="onboarding-logo" />
          <span>puppyone</span>
        </div>
        <div className="onboarding-heading compact">
          <span>Desktop workspace</span>
          <h1>Opening last workspace</h1>
          <p>Restoring your local puppyone workspace...</p>
        </div>
      </section>
    </main>
  );
}
