import type { ComponentType, ReactNode } from "react";
import type { ProjectWorkbenchStore } from "./ProjectWorkbenchStore";
import type { AuxiliaryWorkbenchContribution, WorkbenchLauncherContext } from "./types";

/**
 * The shell's workbench panel. The composition root hands it to a feature that
 * contributes workbench items, so the feature never imports the shell.
 */
export type WorkbenchPanelComponent = ComponentType<{
  store: ProjectWorkbenchStore;
  contributions: readonly AuxiliaryWorkbenchContribution[];
  active: boolean;
  renderLauncher(context: WorkbenchLauncherContext): ReactNode;
}>;
