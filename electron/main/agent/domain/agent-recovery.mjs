import { agentContractLimits } from "../../../../shared/agent-contract/constants.mjs";

/** Recovery observations are scoped facts; model retries do not disconnect the local control channel. */
export function reduceAgentRecoveries(previous = [], event, control) {
  if (['session.closed', 'session.started', 'session.resumed'].includes(event.type)) return [];
  if (['turn.completed', 'turn.failed', 'turn.interrupted'].includes(event.type)) {
    return previous.filter(entry => entry.turnId !== event.turnId || entry.scope === 'transport');
  }
  if (event.type !== 'provider.connection.updated') return previous;
  const payload = event.payload ?? {};
  const scope = payload.scope === 'transport' ? 'transport' : 'upstream-request';
  const turnId = scope === 'transport' ? null : event.turnId ?? control.execution.activeTurnId;
  // Model retries belong to a turn; an uncorrelated late notice must not reopen a settled run.
  if (scope === 'upstream-request' && !turnId) return previous;
  if (turnId && control.terminalTurns.includes(turnId)) return previous;
  const requestId = payload.requestId ?? null;
  const id = payload.recoveryId ?? `${scope}:${control.adapterGeneration}:${turnId ?? 'connection'}:${requestId ?? 'request'}`;
  const remaining = previous.filter(entry => entry.id !== id);
  if (payload.state === 'connected' || payload.state === 'ended') return remaining;
  if (!['reconnecting', 'fallback'].includes(payload.state)) return previous;
  return [...remaining, {
    id, scope, turnId, requestId, adapterGeneration: control.adapterGeneration,
    runGeneration: control.runGeneration, state: payload.state,
    message: typeof payload.message === 'string' ? payload.message.slice(0, agentContractLimits.maxControlReasonLength) : '',
    attempt: positive(payload.attempt), maxAttempts: positive(payload.maxAttempts ?? payload.maxRetries),
  }].slice(-64);
}

export function activeAgentRecovery(control) {
  const entries = control.recoveries ?? [];
  return entries.findLast(entry => entry.adapterGeneration === control.adapterGeneration
    && (entry.scope === 'transport' || (entry.turnId !== null && (entry.turnId === control.execution.activeTurnId || entry.turnId === control.execution.uncertainTurnId)))) ?? null;
}
function positive(value) { return Number.isSafeInteger(value) && value > 0 ? value : null; }
