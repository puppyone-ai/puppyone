export type AgentOperationFailure = Readonly<{
  schemaVersion: 1; code: string; message: string; runtimeId?: string; operation?: string;
  stage?: string; status?: string; retryable: boolean; actions: Array<'sign-in' | 'refresh' | 'learn-more' | 'update'>;
}>;
export function readAgentOperationFailure(value: unknown): AgentOperationFailure | null;
