import { probeCodexLocal } from "../probes/codex-local-probe.mjs";

export const CODEX_LOCAL_TOOL = Object.freeze({
  id: "codex",
  installationId: "codex",
  displayName: "Codex",
  probe: probeCodexLocal,
  unavailableMessage: "Native Codex readiness is evaluated through its app-server protocol.",
});
