/** Incoming work has its own review region; the Header describes this device's work. */
export function reachHeaderChangesStatus<T extends {
  conflicts: number;
  incoming: number;
  localChanges: number;
  outgoing: number;
}>(status: T): T {
  if (status.incoming === 0 && status.outgoing === 0) return status;
  return { ...status, incoming: 0, outgoing: 0 };
}
