import type { ResolvedSurfaceAppearance } from "../appearance/AppearanceRuntime";
import { useLocalization } from "@puppyone/localization";
import { LoadingMark } from "@puppyone/shared-ui";
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
      <LoadingMark layout="area" ariaLabel={t("workspace.restoring.ariaLabel")} size="md" tone="neutral" />
    </main>
  );
}
