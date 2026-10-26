import type { AuxiliaryWorkbenchItemSnapshot } from "../../../lib/workbench/types";
import type { DesktopTerminalSessionSummary } from "../model/terminalSessions";
import type { TerminalRuntimeHandle } from "../runtime/terminalRuntime";

export type TerminalWorkbenchHeaderItem = Readonly<{
  id: string;
  kind: string;
  snapshot: AuxiliaryWorkbenchItemSnapshot;
  terminalSession: DesktopTerminalSessionSummary | null;
  terminalRuntime: TerminalRuntimeHandle | null;
}>;
