import { assertRecord, requiredString, optionalString, enumValue } from './validation.mjs';
const ACTIONS = ['sign-in', 'refresh', 'learn-more', 'update'];

/** Failures cross IPC as plain data; Electron does not preserve Error properties. */
export function readAgentOperationFailure(value) {
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'agentFailure')) return null;
  const failure = assertRecord(value.agentFailure, 'Agent operation failure');
  if (failure.schemaVersion !== 1) throw new TypeError('Unsupported Agent failure version.');
  requiredString(failure.message, 'Agent failure.message', 4_000);
  requiredString(failure.code, 'Agent failure.code', 160);
  for (const key of ['runtimeId', 'operation', 'stage', 'status']) if (failure[key] != null) optionalString(failure[key], `Agent failure.${key}`, 160);
  if (typeof failure.retryable !== 'boolean') throw new TypeError('Invalid Agent failure retry policy.');
  if (!Array.isArray(failure.actions) || failure.actions.length > 4) throw new TypeError('Invalid Agent failure actions.');
  for (const action of failure.actions) enumValue(action, 'Agent failure action', ACTIONS);
  return failure;
}
