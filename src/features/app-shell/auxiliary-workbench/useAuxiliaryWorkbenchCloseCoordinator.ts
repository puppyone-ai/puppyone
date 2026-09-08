import { useCallback, useRef, useState } from "react";
import type {
  AuxiliaryWorkbenchCloseAdapter,
  AuxiliaryWorkbenchCloseContext,
  AuxiliaryWorkbenchCloseDecision,
} from "./types";

type PresentedCloseDecision = Exclude<AuxiliaryWorkbenchCloseDecision, { kind: "close" }>;

export type AuxiliaryWorkbenchCloseTarget = Readonly<{
  context: AuxiliaryWorkbenchCloseContext;
  adapter: AuxiliaryWorkbenchCloseAdapter;
}>;

export type AuxiliaryWorkbenchPendingClose = Readonly<{
  itemId: string;
  decision: PresentedCloseDecision;
}>;

type UseAuxiliaryWorkbenchCloseCoordinatorOptions = Readonly<{
  resolveTarget: (itemId: string) => AuxiliaryWorkbenchCloseTarget | null;
  onClosed: (itemId: string) => void;
}>;

/** Owns one close transaction for every Item kind in the Auxiliary Workbench. */
export function useAuxiliaryWorkbenchCloseCoordinator({
  resolveTarget,
  onClosed,
}: UseAuxiliaryWorkbenchCloseCoordinatorOptions) {
  const [pending, setPending] = useState<AuxiliaryWorkbenchPendingClose | null>(null);
  const [failure, setFailure] = useState<{ itemId: string; detail: string } | null>(null);
  const [commitCount, setCommitCount] = useState(0);
  const committing = commitCount > 0;
  const evaluatingItemIdsRef = useRef(new Set<string>());
  const activeItemIdsRef = useRef(new Set<string>());

  const commit = useCallback(async (target: AuxiliaryWorkbenchCloseTarget) => {
    const itemId = target.context.item.id;
    if (activeItemIdsRef.current.has(itemId)) return false;
    activeItemIdsRef.current.add(itemId);
    setFailure(null);
    setCommitCount((count) => count + 1);
    try {
      const closed = await target.adapter.commit(target.context);
      if (closed) onClosed(itemId);
      return closed;
    } catch (error) {
      setFailure({ itemId, detail: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      activeItemIdsRef.current.delete(itemId);
      setCommitCount((count) => Math.max(0, count - 1));
    }
  }, [onClosed]);

  const presentLatestDecision = useCallback(async (itemId: string) => {
    const latest = resolveTarget(itemId);
    if (!latest) {
      setPending(null);
      return;
    }
    const decision = await latest.adapter.decide(latest.context);
    setPending(decision.kind === "close" ? null : { itemId, decision });
  }, [resolveTarget]);

  const requestClose = useCallback(async (itemId: string) => {
    if (evaluatingItemIdsRef.current.has(itemId) || activeItemIdsRef.current.has(itemId)) return;
    evaluatingItemIdsRef.current.add(itemId);
    try {
      const target = resolveTarget(itemId);
      if (!target) return;
      const decision = await target.adapter.decide(target.context);
      if (decision.kind !== "close") {
        setPending({ itemId, decision });
        return;
      }
      if (!await commit(target)) await presentLatestDecision(itemId);
    } catch (error) {
      setFailure({ itemId, detail: error instanceof Error ? error.message : String(error) });
    } finally {
      evaluatingItemIdsRef.current.delete(itemId);
    }
  }, [commit, presentLatestDecision, resolveTarget]);

  const dismiss = useCallback(() => {
    if (!committing) setPending(null);
  }, [committing]);

  const confirm = useCallback(async () => {
    if (!pending || pending.decision.kind !== "confirm" || committing) return;
    const target = resolveTarget(pending.itemId);
    if (!target) {
      setPending(null);
      return;
    }
    if (await commit(target)) {
      setPending(null);
      return;
    }
    try { await presentLatestDecision(pending.itemId); }
    catch (error) { setFailure({ itemId: pending.itemId, detail: error instanceof Error ? error.message : String(error) }); }
  }, [commit, committing, pending, presentLatestDecision, resolveTarget]);

  return Object.freeze({ committing, confirm, dismiss, pending, requestClose, failure, dismissFailure: () => setFailure(null) });
}
