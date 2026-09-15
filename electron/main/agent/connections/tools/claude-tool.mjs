import { probeVersionedLocalAgent } from "../probes/versioned-local-agent-probe.mjs";
export const CLAUDE_LOCAL_TOOL = Object.freeze({
  id: "claude",
  installationId: "claude",
  displayName: "Claude Code",
  probe: (options) => probeVersionedLocalAgent({
    ...options,
    id: "claude",
    displayName: "Claude Code",
  }),
  unavailableMessage: "Claude Code terminal sessions are launched only from a verified local installation.",
});
