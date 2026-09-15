import { probeVersionedLocalAgent } from "../probes/versioned-local-agent-probe.mjs";

export const OPENCODE_LOCAL_TOOL = Object.freeze({
  id: "opencode",
  installationId: "opencode",
  displayName: "OpenCode",
  probe: (options) => probeVersionedLocalAgent({
    ...options,
    id: "opencode",
    displayName: "OpenCode",
  }),
  unavailableMessage: "OpenCode terminal sessions are launched only from a verified local installation.",
});
