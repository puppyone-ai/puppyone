import type { ProjectSessionContext } from "../project-session-contract/types";

/** Creation identity is fixed before IPC; execution identity is allocated by Main. */
export type ItemExecutionTarget = Readonly<{ kind: "agent" | "terminal"; itemId: string; creationId: string }>;
export type ItemExecutionRequest = ItemExecutionTarget & Readonly<{
  projectContext: ProjectSessionContext;
  operationId: string;
}>;
export type ItemExecutionSummary = ItemExecutionTarget & Readonly<{
  executionId: string;
  projectContext: ProjectSessionContext;
  desiredLifecycle: "active" | "terminated";
  observedLifecycle: "starting" | "live" | "stopping" | "exited";
  cleanup: "pending" | "running" | "confirmed" | "unconfirmed";
  operationId: string | null;
  revision: number;
  errorCode: string | null;
}>;
export type ItemCloseResult =
  | Readonly<{ kind: "released" }>
  | Readonly<{ kind: "handed-off"; receipt: ItemExecutionSummary }>;
export type ItemLifecyclePort = {
  terminateItemExecution(request: ItemExecutionRequest): Promise<ItemExecutionSummary>;
  retryItemExecutionCleanup(request: ItemExecutionRequest): Promise<ItemExecutionSummary>;
  listItemExecutions(request: { projectContext: ProjectSessionContext }): Promise<ItemExecutionSummary[]>;
};
