/** A lost response may still publish. Retrying must keep its exact candidate. */
export function requiresSameCommitRetry(record) {
  const unresolved = (state) => ["uploading", "confirming", "uncertain"].includes(state);
  return unresolved(record.push_state)
    || record.attempt_history.some((attempt) => unresolved(attempt.state));
}
