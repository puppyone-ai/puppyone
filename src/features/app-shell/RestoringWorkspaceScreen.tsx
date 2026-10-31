import type { CSSProperties } from "react";
import type { ResolvedSurfaceAppearance } from "../appearance/AppearanceRuntime";
import { useLocalization } from "@puppyone/localization";
import { LoadingMark } from "@puppyone/shared-ui";
import { DesktopWindowDragRegion } from "../../components/DesktopWindowChrome";
import { useDesktopPreference } from "../settings";

type RestoringWorkspaceScreenProps = {
  appearance: ResolvedSurfaceAppearance;
};

/**
 * Whether a project is coming back is not known until it arrives, so the mark
 * waits where a restored project's mark will be: the centre of the editor
 * region, below the Header and beside the Explorer column.
 */
export function RestoringWorkspaceScreen({
  appearance,
}: RestoringWorkspaceScreenProps) {
  const { t } = useLocalization();
  const resolvedTheme = appearance.appearance.effectiveColorMode;
  const explorerWidth = useDesktopPreference(s => s.explorerWidth);
  const sidebarCollapsed = useDesktopPreference(s => s.sidebarCollapsed);
  const style = {
    ...appearance.rootProps.style,
    "--onboarding-restoring-explorer-width": `${sidebarCollapsed ? 0 : explorerWidth}px`,
  } as CSSProperties;
  return (
    <main
      className={`onboarding-shell onboarding-restoring-shell ${resolvedTheme === "dark" ? "dark" : ""}`}
      data-po-scrollbar="content"
      {...appearance.rootProps}
      style={style}
    >
      <DesktopWindowDragRegion className="onboarding-titlebar" />
      <LoadingMark className="onboarding-restoring-mark" layout="area"
        ariaLabel={t("workspace.restoring.ariaLabel")} size="md" tone="neutral" />
    </main>
  );
}
