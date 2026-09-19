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
import { connectionModels, createModelConnectionBinding } from "./model-connection-binding.mjs";
import { connectionError, parseModelRoute } from "../../../../../shared/model-connections/schema.mjs";

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
    const binding = options.modelConnectionPort ? createModelConnectionBinding(options.modelConnectionPort) : null;
    super({
      ...options,
      ...(binding ? { onEvent: (event) => options.onEvent?.(withoutUnverifiedCost(event)) } : {}),
      ...(binding ? { clientFactory: (clientOptions) => binding.createClient(clientOptions) } : {}),
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
    this.modelConnectionPort = options.modelConnectionPort;
    this.modelBinding = binding;
    this.selectedConnectionModel = null;
    this.readOnly = false;
  }

  async bootstrapSession({ kind, threadId, ...selection }) {
    const inspection = await this.inspect();
    if (this.modelBinding && kind === "resume" && !inspection.models.some((model) => model.model === selection.model)) {
      // Read through the SDK's native session API without authorizing ANY endpoint.
      this.readOnly = true;
      this.modelBinding.enableReadOnly();
      const providerSession = await super.resumeSession({ threadId, model: null, effort: null });
      this.selectedConnectionModel = selection.model;
      return { inspection: { ...inspection, capabilities: { ...inspection.capabilities, readOnly: true, compaction: false } },
        providerSession: { ...providerSession, model: selection.model, effort: null } };
    }
    const providerSession = kind === "resume" ? await this.resumeSession({ threadId, ...selection }) : await this.createSession(selection);
    return { inspection, providerSession };
  }

  async inspect() {
    if (!this.modelConnectionPort) return super.inspect();
    const snapshot = await this.modelConnectionPort.read();
    const models = connectionModels(snapshot);
    const providers = snapshot.connections.map((connection) => ({ id: connection.id, displayName: connection.name,
      source: "model-connection", modelCount: models.filter((model) => model.connectionId === connection.id).length }));
    return {
      account: { account: models.length ? { type: "puppyone-agent", email: null, planType: null } : null,
        requiresOpenaiAuth: false, requiresRuntimeSetup: models.length === 0,
        ...(models.length ? {} : { setupReason: "runtime-setup-required", error: "Add or verify a model connection in Settings → Model Connections." }) },
      models, providers, modes: [], commands: [], warnings: [],
      capabilities: { ...PUPPYONE_AGENT_CAPABILITIES, revision: `puppyone-model-connections:${snapshot.revision}`,
        modelConnections: true,
        referenceInputs: { ...PUPPYONE_AGENT_CAPABILITIES.referenceInputs,
          attachments: { ...PUPPYONE_AGENT_CAPABILITIES.referenceInputs.attachments,
            image: { ...PUPPYONE_AGENT_CAPABILITIES.referenceInputs.attachments.image, accepted: models.some((model) => model.modelCapabilities.images === "supported") } } } },
      runtime: { ...this.runtimeDescriptor, version: this.readiness.version, source: this.readiness.source, compatibility: this.readiness.compatibility },
    };
  }

  async createSession(options = {}) {
    if (this.modelBinding) await this.modelBinding.acquire(options.model);
    try {
      const result = await super.createSession(options);
      this.selectedConnectionModel = options.model;
      return this.modelBinding ? { ...result, effort: null } : result;
    } catch (error) { await this.modelBinding?.dispose(); throw error; }
  }

  async resumeSession(options = {}) {
    if (this.modelBinding) await this.modelBinding.acquire(options.model);
    try {
      const result = await super.resumeSession(options);
      this.selectedConnectionModel = options.model;
      return this.modelBinding ? { ...result, effort: null } : result;
    } catch (error) { await this.modelBinding?.dispose(); throw error; }
  }

  async startTurn(options) {
    if (this.readOnly) throw connectionError("CONNECTION_UNAVAILABLE_READ_ONLY");
    const route = options.model ?? this.selectedConnectionModel;
    if (this.modelBinding) {
      await this.modelBinding.validate(route);
      this.assertModelReferences(route, options.references ?? [...(options.attachments ?? []), ...(options.contextReferences ?? [])]);
    }
    const result = await super.startTurn(options);
    this.selectedConnectionModel = route;
    return result;
  }

  async steerTurn(options) {
    if (this.readOnly) throw connectionError("CONNECTION_UNAVAILABLE_READ_ONLY");
    if (this.modelBinding) {
      await this.modelBinding.validate(this.selectedConnectionModel);
      this.assertModelReferences(this.selectedConnectionModel, options.references ?? []);
    }
    return super.steerTurn(options);
  }

  async compactSession() {
    if (this.readOnly) throw connectionError("CONNECTION_UNAVAILABLE_READ_ONLY");
    if (this.modelBinding) await this.modelBinding.validate(this.selectedConnectionModel);
    return super.compactSession();
  }

  async readHistoryResult() {
    const result = await super.readHistoryResult();
    return this.modelBinding ? { ...result, events: result.events.map(withoutUnverifiedCost) } : result;
  }

  assertModelReferences(route, references) {
    const modelId = parseModelRoute(route).modelId;
    const model = this.modelBinding.configuration?.models.find((entry) => modelId === entry.id);
    if (model?.capabilities.images !== "supported" && references.some((reference) => reference.mime?.startsWith("image/"))) {
      throw connectionError("MODEL_IMAGE_UNSUPPORTED");
    }
  }

  async dispose(reason) {
    try { await super.dispose(reason); }
    finally { await this.modelBinding?.dispose(); }
  }
}

function withoutUnverifiedCost(event) {
  // SDK requires numeric provider prices; its zero placeholders are not billing facts.
  return event.type === "usage.updated" ? { ...event, payload: { ...event.payload, cost: null } } : event;
}
