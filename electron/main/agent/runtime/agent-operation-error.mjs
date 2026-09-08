import { redactSecretText } from '../agent-events.mjs';

export function sanitizeAgentOperationError(value) {
  const error = value instanceof Error ? value : new Error(String(value));
  error.message = redactSecretText(error.message).slice(0, 4_000) || 'Agent operation failed.';
  return error;
}

export function agentOperationFailure(value) {
  const error = sanitizeAgentOperationError(value);
  const failure = {
    schemaVersion: 1,
    code: typeof error.code === 'string' ? error.code.slice(0, 160) : 'AGENT_OPERATION_FAILED',
    message: error.message,
    retryable: error.retryable === true,
    actions: Array.isArray(error.actions) ? [...new Set(error.actions.filter(action => ['sign-in', 'refresh', 'learn-more', 'update'].includes(action)))].slice(0, 4) : [],
  };
  for (const key of ['runtimeId', 'operation', 'stage', 'status']) {
    if (typeof error[key] === 'string') failure[key] = redactSecretText(error[key]).slice(0, 160);
  }
  return { agentFailure: failure };
}
