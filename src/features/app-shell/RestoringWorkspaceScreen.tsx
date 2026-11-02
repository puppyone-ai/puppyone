import type { ResolvedSurfaceAppearance } from "../appearance/AppearanceRuntime";
import { useLocalization } from "@puppyone/localization";
import { LoadingMark } from "@puppyone/shared-ui";
import { DesktopWindowDragRegion } from "../../components/DesktopWindowChrome";

type RestoringWorkspaceScreenProps = {
  appearance: ResolvedSurfaceAppearance;
};

/**
 * The wait for a Homepage. The page has not arrived, so the mark holds the centre
 * of the window. A project coming back waits in its own window instead.
 */
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
      <LoadingMark className="onboarding-restoring-mark" layout="area"
        ariaLabel={t("common.status.loading")} size="md" tone="neutral" />
    </main>
  );
}
