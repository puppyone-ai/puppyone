import { readAgentOperationFailure } from '../../shared/agent-contract/operation-error.mjs';

/** Decode the same plain-data failure envelope used by the Renderer client. */
export function clientHandler(handler) {
  return async (...args) => {
    const result = await handler(...args);
    const failure = readAgentOperationFailure(result);
    if (failure) throw Object.assign(new Error(failure.message), failure);
    return result;
  };
}
