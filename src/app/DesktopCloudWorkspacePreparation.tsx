import type { ComponentProps } from "react";
import { useDesktopExplorerFrame } from "../features/app-shell/layout/useDesktopExplorerFrame";
import { CloudWorkspacePreparation } from "../features/cloud/workbench/CloudWorkspacePreparation";

/**
 * Cloud preparation stands in the window's Explorer column, so the shell
 * supplies that column's frame; the Cloud domain never reaches into the shell.
 */
export function DesktopCloudWorkspacePreparation(
  props: Omit<ComponentProps<typeof CloudWorkspacePreparation>, "explorerFrame">,
) {
  return <CloudWorkspacePreparation {...props} explorerFrame={useDesktopExplorerFrame()} />;
}
