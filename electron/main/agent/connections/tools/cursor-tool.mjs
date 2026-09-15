import { probeCursorLocal } from "../probes/cursor-local-probe.mjs";

export const CURSOR_LOCAL_TOOL = Object.freeze({
  id: "cursor-agent",
  installationId: "cursor",
  displayName: "Cursor Agent",
  probe: probeCursorLocal,
  unavailableMessage: "Install Cursor Agent and sign in to use its native ACP harness.",
});
