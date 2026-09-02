import type { ResolvedSurfaceAppearance } from "../appearance/AppearanceRuntime";
import { useLocalization } from "@puppyone/localization";
import { PulseGrid } from "../../components/loading";
import { DesktopWindowDragRegion } from "../../components/DesktopWindowChrome";

type RestoringWorkspaceScreenProps = {
  appearance: ResolvedSurfaceAppearance;
};

export function RestoringWorkspaceScreen({
  appearance,
}: RestoringWorkspaceScreenProps) {
  const { t } = useLocalization();
  const resolvedTheme = appearance.appearance.effectiveColorMode;
  return (
    <main
      className={`onboarding-shell ${resolvedTheme === "dark" ? "dark" : ""}`}
      data-po-scrollbar="content"
      {...appearance.rootProps}
    >
      <DesktopWindowDragRegion className="onboarding-titlebar" />
      <PulseGrid ariaLabel={t("workspace.restoring.ariaLabel")} size="sm" tone="neutral" />
    </main>
  );
}
