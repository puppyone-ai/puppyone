import { boundRendererValue, redactSecrets } from '../../agent-events.mjs';
import { isApprovalDecision, normalizeNetworkApprovalContext, normalizeCodexQuestions, codexQuestionAnswers } from './codex-native-values.mjs';

/** Native request correlation and response serialization for this adapter. */
export function codexResolveApproval(adapter, { requestId, decision, threadId, turnId }) {
    const pending = adapter.pendingApprovals.get(requestId);
    if (!pending) throw new Error("This approval is no longer pending.");
    if (pending.threadId !== threadId || pending.turnId !== turnId || pending.threadId !== adapter.threadId) {
      throw new Error("Approval correlation did not match the active Codex turn.");
    }
    if (!pending.availableDecisions.includes(decision)) {
      throw new Error("Codex did not offer that approval decision.");
    }
    adapter.connection.respond(pending.rpcId, { decision });
    adapter.pendingApprovals.delete(requestId);
  }

export function codexResolveQuestion(adapter, { requestId, answers, rejected, turnId }) {
    const pending = adapter.pendingQuestions.get(requestId);
    if (!pending || pending.threadId !== adapter.threadId || pending.turnId !== turnId) {
      throw new Error("Question correlation did not match the active Codex turn.");
    }
    adapter.pendingQuestions.delete(requestId);
    adapter.connection.respond(pending.rpcId, {
      answers: rejected ? {} : codexQuestionAnswers(pending.questions, answers),
    });
  }

export function codexHandleServerRequest(adapter, message) {
    const { method, id, params = {} } = message;
    if (method === "item/tool/requestUserInput") {
      codexHandleQuestionRequest(adapter, { id, params });
      return;
    }
    if (method !== "item/commandExecution/requestApproval" && method !== "item/fileChange/requestApproval") {
      adapter.connection.respondError(id, -32601, `Unsupported Codex server request: ${method}`);
      adapter.onEvent({
        type: "provider.warning",
        turnId: typeof params.turnId === "string" ? params.turnId : null,
        itemId: typeof params.itemId === "string" ? params.itemId : null,
        payload: { message: `Codex requested unsupported input (${method}); it was denied.` },
      });
      return;
    }
    if (
      typeof params.threadId !== "string"
      || params.threadId !== adapter.threadId
      || typeof params.turnId !== "string"
      || typeof params.itemId !== "string"
    ) {
      adapter.connection.respond(id, { decision: "cancel" });
      adapter.onEvent({
        type: "provider.error",
        payload: { message: "A Codex approval had impossible session ownership and was cancelled.", recoverable: false },
      });
      return;
    }
    const explicitDecisions = Array.isArray(params.availableDecisions)
      ? params.availableDecisions.filter(isApprovalDecision)
      : [];
    const availableDecisions = explicitDecisions.length > 0
      ? explicitDecisions
      : ["accept", "decline", "cancel"];
    const requestId = `codex:${String(id)}`;
    const kind = method.includes("commandExecution") ? "command" : "file-change";
    const networkApprovalContext = normalizeNetworkApprovalContext(params.networkApprovalContext);
    adapter.pendingApprovals.set(requestId, {
      rpcId: id,
      requestId,
      kind,
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      availableDecisions,
    });
    adapter.onEvent({
      type: "approval.requested",
      providerSessionId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      payload: boundRendererValue(redactSecrets({
        requestId,
        kind,
        title: networkApprovalContext
          ? "Allow network access"
          : kind === "command"
            ? "Run command"
            : "Apply file changes",
        command: typeof params.command === "string" ? params.command : null,
        cwd: typeof params.cwd === "string" ? params.cwd : null,
        commandActions: Array.isArray(params.commandActions) ? params.commandActions : [],
        networkApprovalContext,
        reason: typeof params.reason === "string" ? params.reason : null,
        grantRoot: typeof params.grantRoot === "string" ? params.grantRoot : null,
        proposedExecpolicyAmendment: params.proposedExecpolicyAmendment ?? null,
        proposedNetworkPolicyAmendments: Array.isArray(params.proposedNetworkPolicyAmendments)
          ? params.proposedNetworkPolicyAmendments
          : [],
        availableDecisions,
        startedAtMs: Number.isFinite(params.startedAtMs) ? params.startedAtMs : Date.now(),
      })),
    });
  }

export function codexHandleQuestionRequest(adapter, { id, params }) {
    if (
      typeof params.threadId !== "string"
      || params.threadId !== adapter.threadId
      || typeof params.turnId !== "string"
      || typeof params.itemId !== "string"
    ) {
      adapter.connection.respond(id, { answers: {} });
      adapter.onEvent({
        type: "provider.error",
        payload: { message: "A Codex question had impossible session ownership and was cancelled.", recoverable: false },
      });
      return;
    }
    const questions = normalizeCodexQuestions(params.questions);
    const requestId = `codex:question:${String(id)}`;
    adapter.pendingQuestions.set(requestId, {
      rpcId: id,
      requestId,
      threadId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      questions,
    });
    adapter.onEvent({
      type: "question.requested",
      providerSessionId: params.threadId,
      turnId: params.turnId,
      itemId: params.itemId,
      payload: { requestId, questions: questions.map(({ id: _id, ...question }) => question) },
    });
  }

export function codexHandleServerRequestResolved(adapter, params) {
    const providerRequestId = params?.requestId;
    if (typeof providerRequestId !== "string" && typeof providerRequestId !== "number") return;
    const normalizedProviderId = String(providerRequestId).replace(/^codex:/, "");
    const pending = Array.from(adapter.pendingApprovals.values()).find((entry) => (
      String(entry.rpcId) === normalizedProviderId || entry.requestId === String(providerRequestId)
    ));
    if (!pending) return;
    adapter.pendingApprovals.delete(pending.requestId);
    adapter.onEvent({
      type: "approval.resolved",
      providerSessionId: pending.threadId,
      turnId: pending.turnId,
      itemId: pending.itemId,
      payload: { requestId: pending.requestId, decision: "cancel", reason: "provider-resolved" },
    });
  }

export function codexClearPendingApprovalsForTurn(adapter, turnId, reason, respond = false) {
    if (!turnId) return;
    for (const pending of Array.from(adapter.pendingApprovals.values())) {
      if (pending.turnId !== turnId) continue;
      if (respond && adapter.connection && !adapter.connection.closed) {
        try {
          adapter.connection.respond(pending.rpcId, { decision: "cancel" });
        } catch {
          // A closed provider cannot execute an unapproved action.
        }
      }
      adapter.pendingApprovals.delete(pending.requestId);
      adapter.onEvent({
        type: "approval.resolved",
        providerSessionId: pending.threadId,
        turnId: pending.turnId,
        itemId: pending.itemId,
        payload: { requestId: pending.requestId, decision: "cancel", reason },
      });
    }
  }

export function codexClearPendingApprovals(adapter, decision, respond) {
    for (const pending of adapter.pendingApprovals.values()) {
      if (respond && adapter.connection && !adapter.connection.closed) {
        try {
          adapter.connection.respond(pending.rpcId, { decision });
        } catch {
          // A closed provider cannot execute an unapproved action.
        }
      }
      adapter.onEvent({
        type: "approval.resolved",
        providerSessionId: pending.threadId,
        turnId: pending.turnId,
        itemId: pending.itemId,
        payload: { requestId: pending.requestId, decision, reason: "adapter-closed" },
      });
    }
    adapter.pendingApprovals.clear();
  }

export function codexClearPendingQuestionsForTurn(adapter, turnId, respond = false) {
    for (const pending of Array.from(adapter.pendingQuestions.values())) {
      if (pending.turnId !== turnId) continue;
      if (respond && adapter.connection && !adapter.connection.closed) {
        try {
          adapter.connection.respond(pending.rpcId, { answers: {} });
        } catch {
          // A closed provider cannot keep waiting for user input.
        }
      }
      adapter.pendingQuestions.delete(pending.requestId);
    }
  }

export function codexClearPendingQuestions(adapter, respond) {
    for (const pending of adapter.pendingQuestions.values()) {
      if (respond && adapter.connection && !adapter.connection.closed) {
        try {
          adapter.connection.respond(pending.rpcId, { answers: {} });
        } catch {
          // A closed provider cannot keep waiting for user input.
        }
      }
    }
    adapter.pendingQuestions.clear();
  }
