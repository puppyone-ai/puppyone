import { randomUUID } from "node:crypto";
import { authorizeAgentReferences, createAgentReferenceBudget, workspaceDraftReferences } from "../agent/agent-reference-authorization.mjs";
import { requireSupportedAgentReferences } from "../agent/application/agent-input-policy.mjs";
import { assertAgentIpcResponse, parseAgentIpcRequest } from "../../../shared/agent-contract/schema.mjs";

export function registerAgentIpcHandlers({
  ipcMain,
  agentService,
  localAgentInventory,
  authorizeWorkspaceRoot,
  resolveWorkspaceResource,
  attachmentStore,
  dialog,
  getDialogOwnerWindow,
}) {
  const register = (channel, handler) => {
    ipcMain.handle(channel, async (event, rawRequest) => {
      const request = parseAgentIpcRequest(channel, rawRequest);
      const response = await handler(event, request);
      return assertAgentIpcResponse(channel, response);
    });
  };

  const authorizeOptionalRoot = async (event, request) => (
    request.rootPath ? authorizeWorkspaceRoot(event, request.rootPath) : null
  );
  const authorizeRequiredRoot = (event, request) => authorizeWorkspaceRoot(event, request.rootPath);
  const resourceResolver = (event, workspaceRoot) => resolveWorkspaceResource
    ? (resource) => resolveWorkspaceResource(event, resource, { legacyRoot: workspaceRoot })
    : undefined;
  const dispatchSteer = async (event, request) => {
    const workspaceRoot = await authorizeRequiredRoot(event, request);
    const referenceCapabilities = agentService.getReferenceInputCapabilities(event.sender, request.sessionId, workspaceRoot);
    const { authorized, stagedTokens } = await authorizeTurnReferences({
      attachmentStore,
      ownerId: event.sender.id,
      workspaceRoot,
      epoch: request.referenceEpoch,
      references: request.references,
      referenceCapabilities,
      resolveResource: resourceResolver(event, workspaceRoot),
    });
    return withStagedReferenceLease({
      attachmentStore,
      ownerId: event.sender.id,
      workspaceRoot,
      epoch: request.referenceEpoch,
      tokens: stagedTokens,
      invoke: (privateReferenceLease) => agentService.steerTurn(event.sender, {
        ...request,
        ...(authorized.length > 0 ? { references: authorized } : {}),
        ...(privateReferenceLease ? { privateReferenceLease } : {}),
      }, workspaceRoot),
    });
  };
  const dispatchStart = async (event, request) => {
    const workspaceRoot = await authorizeRequiredRoot(event, request);
    const referenceCapabilities = agentService.getReferenceInputCapabilities(event.sender, request.sessionId, workspaceRoot);
    const legacyReferences = [
      ...(Array.isArray(request.contextReferences) ? request.contextReferences : []),
      ...(Array.isArray(request.attachments) ? request.attachments : []),
    ].map((entry) => ({ ...entry, kind: "workspace-entry", entryType: "file" }));
    const { authorized, stagedTokens } = await authorizeTurnReferences({
      attachmentStore,
      ownerId: event.sender.id,
      workspaceRoot,
      epoch: request.referenceEpoch,
      references: Array.isArray(request.references) ? request.references : legacyReferences,
      referenceCapabilities,
      resolveResource: resourceResolver(event, workspaceRoot),
    });
    return withStagedReferenceLease({
      attachmentStore,
      ownerId: event.sender.id,
      workspaceRoot,
      epoch: request.referenceEpoch,
      tokens: stagedTokens,
      invoke: (privateReferenceLease) => agentService.startTurn(event.sender, {
        ...request,
        references: authorized,
        attachments: undefined,
        contextReferences: undefined,
        ...(privateReferenceLease ? { privateReferenceLease } : {}),
      }, workspaceRoot),
    });
  };

  register("agent:providers-discover", async (event, request) => (
    agentService.discoverProviders(event.sender, request, await authorizeOptionalRoot(event, request))
  ));
  register("agent:local-connections-discover", async (event, request) => (
    localAgentInventory.discover({
      refresh: request.refresh === true,
      workspaceRoot: await authorizeOptionalRoot(event, request),
    })
  ));
  register("agent:models-list", async (event, request) => (
    agentService.listModels(event.sender, request, await authorizeOptionalRoot(event, request))
  ));
  register("agent:account-read", async (event, request) => (
    agentService.readAccount(event.sender, request, await authorizeOptionalRoot(event, request))
  ));
  register("agent:session-create", async (event, request) => (
    agentService.createSession(event.sender, request, await authorizeRequiredRoot(event, request))
  ));
  register("agent:session-resume", async (event, request) => (
    agentService.resumeSession(event.sender, request, await authorizeRequiredRoot(event, request))
  ));
  register("agent:session-open", async (event, request) => (
    agentService.openSession(event.sender, request, await authorizeRequiredRoot(event, request))
  ));
  register("agent:session-replay", async (event, request) => (
    agentService.replay(event.sender, request, await authorizeRequiredRoot(event, request))
  ));
  register("agent:session-attach", async (event, request) => (
    agentService.attachSession(event.sender, request, await authorizeRequiredRoot(event, request))
  ));
  register("agent:session-feed-ack", async (event, request) => (
    agentService.acknowledgeSession(event.sender, request, await authorizeRequiredRoot(event, request))
  ));
  register("agent:session-feed-watermark", async (event, request) => (
    agentService.readSessionWatermark(event.sender, request, await authorizeRequiredRoot(event, request))
  ));
  register("agent:session-detach", async (event, request) => (
    agentService.detachSession(event.sender, request, await authorizeRequiredRoot(event, request))
  ));
  register("agent:sessions-list", async (event, request) => (
    agentService.listSessions(event.sender, request, await authorizeRequiredRoot(event, request))
  ));
  register("agent:session-fork", async (event, request) => (
    agentService.forkSession(event.sender, request, await authorizeRequiredRoot(event, request))
  ));
  register("agent:session-archive", async (event, request) => (
    agentService.archiveSession(event.sender, request, await authorizeRequiredRoot(event, request))
  ));
  register("agent:session-delete", async (event, request) => (
    agentService.deleteSession(event.sender, request, await authorizeRequiredRoot(event, request))
  ));
  register("agent:session-close", async (event, request) => (
    agentService.closeSession(event.sender, request, await authorizeRequiredRoot(event, request))
  ));
  register("agent:reference-stage", async (event, request) => {
    const workspaceRoot = await authorizeRequiredRoot(event, request);
    return attachmentStore.stage({
      ownerId: event.sender.id,
      workspaceRoot,
      epoch: request.epoch,
      sourcePaths: request.sourcePaths,
    });
  });
  register("agent:reference-revoke", async (event, request) => {
    const workspaceRoot = await authorizeRequiredRoot(event, request);
    return attachmentStore.revoke({ ownerId: event.sender.id, workspaceRoot, tokens: request.tokens });
  });
  register("agent:reference-resolve-workspace", async (event, request) => {
    const workspaceRoot = await authorizeRequiredRoot(event, request);
    return workspaceDraftReferences(await authorizeAgentReferences({ workspaceRoot, references: request.paths, resolveResource: resourceResolver(event, workspaceRoot) }));
  });
  register("agent:reference-pick-workspace", async (event, request) => {
    const workspaceRoot = await authorizeRequiredRoot(event, request);
    const result = await dialog.showOpenDialog(getDialogOwnerWindow?.(event.sender), {
      defaultPath: workspaceRoot,
      properties: ["openFile", "openDirectory", "multiSelections"],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return workspaceDraftReferences(await authorizeAgentReferences({ workspaceRoot, references: result.filePaths, resolveResource: resourceResolver(event, workspaceRoot) }));
  });
  register("agent:turn-steer", dispatchSteer);
  register("agent:turn-interrupt", async (event, request) => (
    agentService.interruptTurn(event.sender, request, await authorizeRequiredRoot(event, request))
  ));
  register("agent:session-compact", async (event, request) => (
    agentService.compactSession(event.sender, request, await authorizeRequiredRoot(event, request))
  ));
  register("agent:approval-resolve", async (event, request) => (
    agentService.resolveApproval(event.sender, request, await authorizeRequiredRoot(event, request))
  ));
  register("agent:question-resolve", async (event, request) => (
    agentService.resolveQuestion(event.sender, request, await authorizeRequiredRoot(event, request))
  ));

  register("agent:turn-start", dispatchStart);
  register("agent:command-dispatch", async (event, request) => {
    switch (request.kind) {
      case "start": return dispatchStart(event, request);
      case "steer": return dispatchSteer(event, request);
      case "interrupt": return agentService.interruptTurn(event.sender, request, await authorizeRequiredRoot(event, request));
      case "approval": return agentService.resolveApproval(event.sender, request, await authorizeRequiredRoot(event, request));
      case "question": return agentService.resolveQuestion(event.sender, request, await authorizeRequiredRoot(event, request));
      default: throw new Error("Unsupported Agent command kind.");
    }
  });
}

async function withStagedReferenceLease({ attachmentStore, ownerId, workspaceRoot, epoch, tokens, invoke }) {
  if (!Array.isArray(tokens) || tokens.length === 0) return invoke(null);
  const leaseId = `lease-${randomUUID()}`;
  await attachmentStore.lease({ ownerId, workspaceRoot, epoch, tokens, leaseId });
  try {
    return await invoke({ leaseId, tokens: [...tokens] });
  } catch (error) {
    await attachmentStore.releaseLease({ ownerId, workspaceRoot, tokens, leaseId }).catch(() => undefined);
    throw error;
  }
}

async function authorizeTurnReferences({
  attachmentStore,
  ownerId,
  workspaceRoot,
  epoch,
  references,
  referenceCapabilities,
  resolveResource,
}) {
  const values = Array.isArray(references) ? references : [];
  requireSupportedAgentReferences({ referenceInputs: referenceCapabilities }, values);
  const budget = createAgentReferenceBudget();
  const workspace = await authorizeAgentReferences({
    workspaceRoot,
    references: values.filter((entry) => entry?.kind !== "staged-attachment"),
    budget,
    resolveResource,
  });
  const stagedDrafts = values.filter((entry) => entry?.kind === "staged-attachment");
  if (stagedDrafts.length > budget.remainingReferences) {
    throw new Error("Agent references exceed the 32-file safety limit.");
  }
  const staged = stagedDrafts.length > 0
    ? await attachmentStore.authorize({ ownerId, workspaceRoot, epoch, references: stagedDrafts })
    : [];
  const stagedBytes = staged.reduce((total, entry) => total + (entry.size ?? 0), 0);
  if (stagedBytes > budget.remainingBytes) throw new Error("Agent references exceed the 25 MB total safety limit.");
  requireSupportedAgentReferences({ referenceInputs: referenceCapabilities }, [...workspace, ...staged]);
  return {
    authorized: [...workspace, ...staged],
    stagedTokens: Array.from(new Set(stagedDrafts.map((entry) => entry.token))),
  };
}
