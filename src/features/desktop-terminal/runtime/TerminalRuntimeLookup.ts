import type { TerminalRuntimeHandle } from "./terminalRuntime";

/** Read-only port for terminal-only visual fixtures; it owns no resources. */
export type TerminalRuntimeLookup = {
  get(id: string): TerminalRuntimeHandle | null;
  require(id: string): TerminalRuntimeHandle;
};
