import type { MessageFormatter } from "@puppyone/localization/core";
import type { AuxiliaryWorkbenchProject } from "../../app-shell/auxiliary-workbench/types";
import { TerminalRuntimePool } from "../runtime/TerminalRuntimePool";
import { createTerminalSessionBridge } from "../runtime/terminalSessionBridge";

/** The project owns terminal screens and connections across tab moves and sidebar visibility. */
export function projectTerminalRuntimes(project: AuxiliaryWorkbenchProject, t: MessageFormatter) {
  return project.getResource("terminals", () => new TerminalRuntimePool(project, t, () => {
    const bridge = window.puppyoneDesktop;
    if (!bridge) throw new Error("Terminal session transport is unavailable.");
    return createTerminalSessionBridge(bridge);
  }));
}
