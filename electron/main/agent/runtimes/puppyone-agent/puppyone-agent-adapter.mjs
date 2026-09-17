import {
  PI_CAPABILITIES,
  PiRpcRuntimeAdapter,
} from "../../protocols/pi-rpc/pi-rpc-runtime-adapter.mjs";
import {
  formatAuthorizedProjectInstructions,
  loadAuthorizedProjectInstructions,
} from "../../security/authorized-project-instructions.mjs";
import { parsePuppyOneAgentApprovalRequest } from "./puppyone-agent-approval.mjs";
import { puppyOneAgentHistorySource } from "./puppyone-agent-history-source.mjs";
import { PUPPYONE_AGENT_RUNTIME_DESCRIPTOR } from "./puppyone-agent-identity.mjs";
import { BUILT_IN_AGENT_DISPLAY_NAME } from "./puppyone-agent-public-identity.mjs";

export const PUPPYONE_AGENT_CAPABILITIES = Object.freeze({
  ...PI_CAPABILITIES,
  manualApprovals: true,
  skills: false,
  revision: "puppyone-pi-rpc:1",
  protocol: Object.freeze({ name: "puppyone-pi-rpc", version: 1 }),
});

/** Product-owned harness route. It never reads the user's Pi profile or binary. */
export class PuppyOneAgentAdapter extends PiRpcRuntimeAdapter {
  constructor(options = {}) {
    const profilePath = options.readiness?.profilePath;
    if (!profilePath) throw new TypeError(`${BUILT_IN_AGENT_DISPLAY_NAME} managed profile is unavailable.`);
    super({
      ...options,
      runtimeDescriptor: options.runtimeDescriptor ?? PUPPYONE_AGENT_RUNTIME_DESCRIPTOR,
      historySource: options.historySource ?? puppyOneAgentHistorySource(profilePath),
      runtimeLabel: BUILT_IN_AGENT_DISPLAY_NAME,
      runtimeNamespace: "puppyone-agent",
      providerSource: "puppyone-agent",
      accountType: "puppyone-agent",
      capabilities: PUPPYONE_AGENT_CAPABILITIES,
      runtimeSetupMessage: `${BUILT_IN_AGENT_DISPLAY_NAME} has no configured model provider. Add a provider credential to PuppyOne, then refresh.`,
      projectInstructionLoader: options.projectInstructionLoader ?? loadAuthorizedProjectInstructions,
      projectInstructionFormatter: options.projectInstructionFormatter ?? formatAuthorizedProjectInstructions,
      approvalRequestParser: options.approvalRequestParser ?? parsePuppyOneAgentApprovalRequest,
    });
  }
}
