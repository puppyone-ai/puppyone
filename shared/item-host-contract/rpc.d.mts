export type HostRpc = Readonly<{
  call(method: string, args?: unknown[], options?: { timeoutMs?: number }): Promise<any>;
  receive(message: unknown): Promise<void>;
  close(error?: Error): void;
  diagnostics(): { pending: number; pendingBytes: number; incoming: number; closed: boolean };
}>;
export function hostError(code: string, message: string): Error & { code: string };
export function createHostRpc(options: {
  generation: string; send(message: unknown): void; handle?(method: string, args: unknown[]): Promise<unknown>;
  timeoutMs?: number; maxPending?: number; maxMessageBytes?: number; maxPendingBytes?: number;
}): HostRpc;
