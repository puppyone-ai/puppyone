/** Session transport: how renderer items reach their main-process sessions. */
export { unwrapSessionConnection } from "./sessionConnection";
export { receiveSessionPort } from "./sessionPorts";
export { handOffItemExecution } from "./itemLifecycleClient";
export { ManagedOperationScope, ScopedOperationTimeoutError, waitForScopedOperation } from "./ManagedOperationScope";
