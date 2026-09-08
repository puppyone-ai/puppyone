import { useState } from "react";

/** A native session binding may arrive after the first preview. Only a real
 * conversation/runtime replacement remounts the transcript, never that binding. */
export function useTranscriptScope(owner: object, sessionId: string | null, runtimeId: string | null) {
  const [scope, setScope] = useState({ owner, sessionId, runtimeId, generation: 0 });
  if (scope.owner !== owner || scope.sessionId !== sessionId || scope.runtimeId !== runtimeId) {
    const replacement = scope.owner !== owner || scope.runtimeId !== runtimeId
      || (scope.sessionId !== null && scope.sessionId !== sessionId);
    const next = { owner, sessionId, runtimeId, generation: scope.generation + Number(replacement) };
    setScope(next);
    return next.generation;
  }
  return scope.generation;
}
