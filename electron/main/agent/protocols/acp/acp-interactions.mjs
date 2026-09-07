import { randomUUID } from 'node:crypto';
import { boundRendererValue, redactSecrets, redactSecretText } from '../../agent-events.mjs';
import { event, array, record, safeId, text } from './acp-native-values.mjs';

/** Native request correlation and response serialization for this adapter. */
export function acpResolveApproval(adapter, { requestId, decision, turnId }) {
    const pending = adapter.pendingApprovals.get(requestId);
    if (!pending || pending.turnId !== turnId || adapter.activeTurn?.turnId !== turnId) {
      throw new Error(`Approval correlation did not match the active ${adapter.runtimeDescriptor.displayName} turn.`);
    }
    adapter.pendingApprovals.delete(requestId);
    const option = selectPermissionOption(pending.options, decision);
    pending.resolve(option
      ? { outcome: { outcome: "selected", optionId: option.optionId } }
      : { outcome: { outcome: "cancelled" } });
  }

export function acpResolveQuestion(adapter, { requestId, answers, rejected, turnId }) {
    const pending = adapter.pendingQuestions.get(requestId);
    if (!pending || pending.turnId !== turnId || adapter.activeTurn?.turnId !== turnId) {
      throw new Error(`Question correlation did not match the active ${adapter.runtimeDescriptor.displayName} turn.`);
    }
    adapter.pendingQuestions.delete(requestId);
    pending.resolve(rejected
      ? { outcome: "cancelled" }
      : { outcome: "answered", answers: questionAnswerMap(pending.questions, answers) });
  }

export function acpRequestPermission(adapter, request) {
    if (!adapter.activeTurn || request?.sessionId !== adapter.sessionId) {
      return Promise.resolve({ outcome: { outcome: "cancelled" } });
    }
    const options = array(request.options).filter((option) => safeId(option?.optionId));
    const requestId = `${adapter.runtimeDescriptor.id}:${safeId(request.toolCall?.toolCallId) ?? randomUUID()}:${randomUUID()}`;
    const input = record(request.toolCall?.rawInput);
    return new Promise((resolve) => {
      adapter.pendingApprovals.set(requestId, {
        requestId,
        turnId: adapter.activeTurn.turnId,
        options,
        resolve,
      });
      adapter.onEvent(event("approval.requested", adapter.sessionId, adapter.activeTurn.turnId,
        safeId(request.toolCall?.toolCallId), {
          requestId,
          title: text(request.toolCall?.title, 300) || "Approval required",
          kind: approvalKind(request.toolCall?.kind),
          command: text(input.command, 8_192) || null,
          reason: text(request.toolCall?.title, 2_000) || null,
          availableDecisions: availableDecisions(options),
          arguments: boundRendererValue(redactSecrets(input)),
        }));
    });
  }

export function acpHandleExtensionRequest(adapter, method, request) {
    if (!adapter.questionMethods.has(method)) return undefined;
    if (!adapter.activeTurn) return { outcome: "cancelled" };
    const questions = normalizeQuestions(request?.questions);
    const requestId = `${adapter.runtimeDescriptor.id}:question:${safeId(request?.toolCallId) ?? randomUUID()}:${randomUUID()}`;
    return new Promise((resolve) => {
      adapter.pendingQuestions.set(requestId, {
        requestId,
        turnId: adapter.activeTurn.turnId,
        questions,
        resolve,
      });
      adapter.onEvent(event("question.requested", adapter.sessionId, adapter.activeTurn.turnId,
        safeId(request?.toolCallId), { requestId, questions }));
    });
  }

export function acpResolvePending(adapter, message) {
    for (const pending of adapter.pendingApprovals.values()) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    }
    for (const pending of adapter.pendingQuestions.values()) pending.resolve({ outcome: "cancelled" });
    if (adapter.pendingApprovals.size > 0 || adapter.pendingQuestions.size > 0) adapter.logger.warn?.(redactSecretText(message));
    adapter.pendingApprovals.clear();
    adapter.pendingQuestions.clear();
  }

function selectPermissionOption(options, decision) {
  const desired = decision === "acceptForSession"
    ? ["allow_always", "allow_once"]
    : decision === "accept"
      ? ["allow_once", "allow_always"]
      : decision === "decline"
        ? ["reject_once", "reject_always"]
        : [];
  return desired.map((kind) => options.find((option) => option.kind === kind)).find(Boolean) ?? null;
}

function availableDecisions(options) {
  const decisions = [];
  if (options.some((option) => option.kind === "allow_once" || option.kind === "allow_always")) decisions.push("accept");
  if (options.some((option) => option.kind === "allow_always")) decisions.push("acceptForSession");
  if (options.some((option) => option.kind === "reject_once" || option.kind === "reject_always")) decisions.push("decline");
  decisions.push("cancel");
  return decisions;
}

function approvalKind(kind) {
  return ["edit", "delete", "move"].includes(kind) ? "file-change" : kind === "execute" ? "command" : "tool";
}

function normalizeQuestions(value) {
  return array(value).slice(0, 16).map((question, index) => ({
    id: safeId(question?.id) || `question-${index + 1}`,
    header: text(question?.header, 160) || text(question?.title, 160) || `Question ${index + 1}`,
    question: text(question?.question, 2_000) || text(question?.prompt, 2_000) || "Input required",
    multiple: Boolean(question?.multiple || question?.multiSelect),
    custom: question?.custom !== false,
    options: array(question?.options).slice(0, 64).map((option) => ({
      id: safeId(option?.id) || safeId(option?.value) || null,
      label: text(option?.label, 300) || text(option?.name, 300) || text(option?.value, 300),
      description: text(option?.description, 1_000),
    })).filter((option) => option.label),
  }));
}

function questionAnswerMap(questions, answers) {
  return Object.fromEntries(questions.map((question, index) => [
    question.id,
    array(answers?.[index]).map((answer) => text(answer, 2_000)).filter(Boolean),
  ]));
}
