import { randomUUID } from 'node:crypto';
import { boundRendererValue, redactSecrets } from '../../agent-events.mjs';
import { asArray, safeId, bounded, humanize } from './claude-native-values.mjs';

/** Native request correlation and response serialization for this adapter. */
export function claudeResolveApproval(adapter, { requestId, decision, turnId }) {
    const pending = adapter.pendingApprovals.get(requestId);
    if (!pending || pending.turnId !== turnId || turnId !== adapter.activeTurnId) {
      throw new Error("Approval correlation did not match the active Claude Code turn.");
    }
    adapter.pendingApprovals.delete(requestId);
    if (decision === "accept" || decision === "acceptForSession") {
      const updatedPermissions = decision === "acceptForSession"
        ? asArray(pending.suggestions).filter((suggestion) => suggestion?.destination === "session")
        : [];
      pending.resolve({
        behavior: "allow",
        updatedInput: pending.input,
        ...(updatedPermissions.length ? { updatedPermissions } : {}),
      });
      return;
    }
    pending.resolve({
      behavior: "deny",
      message: decision === "cancel" ? "User interrupted." : "User denied this action.",
      interrupt: decision === "cancel",
    });
  }

export function claudeResolveQuestion(adapter, { requestId, answers, rejected, turnId }) {
    const pending = adapter.pendingQuestions.get(requestId);
    if (!pending || pending.turnId !== turnId || turnId !== adapter.activeTurnId) {
      throw new Error("Question correlation did not match the active Claude Code turn.");
    }
    adapter.pendingQuestions.delete(requestId);
    if (rejected) {
      pending.resolve({ behavior: "deny", message: "User declined to answer.", interrupt: true });
      return;
    }
    pending.resolve({
      behavior: "allow",
      updatedInput: { ...pending.input, answers: questionAnswerMap(pending.questions, answers) },
    });
  }

export function claudeRequestPermission(adapter, toolName, input, options = {}) {
    if (adapter.disposed || !adapter.activeTurnId) {
      return Promise.resolve({ behavior: "deny", message: "No active Claude Code session owns this request." });
    }
    if (toolName === "AskUserQuestion") return claudeRequestQuestion(adapter, input, options);
    const requestId = `claude:${safeId(options.toolUseID) || randomUUID()}`;
    return new Promise((resolve) => {
      const pending = {
        requestId,
        turnId: adapter.activeTurnId,
        input: input ?? {},
        suggestions: options.suggestions,
        resolve,
      };
      adapter.pendingApprovals.set(requestId, pending);
      listenForAbort(options.signal, () => {
        if (!adapter.pendingApprovals.delete(requestId)) return;
        resolve({ behavior: "deny", message: "Approval request was cancelled.", interrupt: true });
      });
      adapter.onEvent({
        type: "approval.requested",
        providerSessionId: adapter.sessionId,
        turnId: adapter.activeTurnId,
        itemId: safeId(options.toolUseID),
        payload: {
          requestId,
          title: bounded(options.title, 300) || `Allow ${humanize(toolName)}`,
          description: bounded(options.description, 2_000) || bounded(options.decisionReason, 2_000),
          displayName: bounded(options.displayName, 160) || humanize(toolName),
          kind: permissionKind(toolName),
          toolName: bounded(toolName, 160),
          input: boundRendererValue(redactSecrets(input)),
          availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
        },
      });
    });
  }

export function claudeRequestQuestion(adapter, input, options) {
    const requestId = `claude:${safeId(options.toolUseID) || randomUUID()}`;
    const questions = normalizeQuestions(input?.questions);
    return new Promise((resolve) => {
      adapter.pendingQuestions.set(requestId, {
        requestId,
        turnId: adapter.activeTurnId,
        input: input ?? {},
        questions,
        resolve,
      });
      listenForAbort(options.signal, () => {
        if (!adapter.pendingQuestions.delete(requestId)) return;
        resolve({ behavior: "deny", message: "Question request was cancelled.", interrupt: true });
      });
      adapter.onEvent({
        type: "question.requested",
        providerSessionId: adapter.sessionId,
        turnId: adapter.activeTurnId,
        itemId: safeId(options.toolUseID),
        payload: { requestId, questions },
      });
    });
  }

export function claudeResolvePending(adapter, message) {
    for (const pending of adapter.pendingApprovals.values()) {
      pending.resolve({ behavior: "deny", message, interrupt: true });
    }
    for (const pending of adapter.pendingQuestions.values()) {
      pending.resolve({ behavior: "deny", message, interrupt: true });
    }
    adapter.pendingApprovals.clear();
    adapter.pendingQuestions.clear();
  }

function normalizeQuestions(value) {
  return asArray(value).slice(0, 8).map((question) => ({
    header: bounded(question?.header, 80),
    question: bounded(question?.question, 4_000),
    multiple: question?.multiSelect === true,
    custom: question?.isOther !== false,
    options: asArray(question?.options).slice(0, 20).map((option) => typeof option === "string"
      ? { label: bounded(option, 120), description: "" }
      : { label: bounded(option?.label, 120), description: bounded(option?.description, 1_000) }),
  })).filter((question) => question.question);
}

function questionAnswerMap(questions, answers) {
  return Object.fromEntries(questions.map((question, index) => {
    const row = asArray(answers?.[index]).map((answer) => bounded(answer, 4_000)).filter(Boolean);
    return [question.question, question.multiple ? row : row[0] ?? ""];
  }));
}

function listenForAbort(signal, callback) {
  if (!signal) return;
  if (signal.aborted) callback();
  else signal.addEventListener("abort", callback, { once: true });
}

function permissionKind(toolName) {
  const name = String(toolName).toLowerCase();
  if (name === "bash") return "command";
  if (["write", "edit", "multiedit", "notebookedit"].includes(name)) return "file-change";
  if (name.includes("web")) return "network";
  return "tool";
}
