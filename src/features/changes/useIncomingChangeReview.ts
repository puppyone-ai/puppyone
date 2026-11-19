import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GitStatusSnapshot } from "../../types/electron";
import {
  getIncomingChangeReceipt,
  type IncomingChangeReceipt,
} from "./incomingChangeReceipt";
import {
  isSetAside,
  readSetAsideReceipts,
  restoreReceipt,
  setAsideReceipt,
  type IncomingReviewStorage,
  type SetAsideReceipt,
} from "./incomingReviewLedger";

export type IncomingChangeReviewState = "inactive" | "none" | "pending" | "set-aside";

export type IncomingChangeReview = {
  state: IncomingChangeReviewState;
  receipt: IncomingChangeReceipt | null;
  applying: boolean;
  /** Applying ended without changing the files on this Mac. */
  applyFailed: boolean;
  apply: () => void;
  setAside: () => void;
  restore: () => void;
};

export function useIncomingChangeReview({
  status,
  active,
  onApply,
  storage = defaultStorage(),
  now = () => new Date(),
}: {
  status: GitStatusSnapshot | null;
  active: boolean;
  onApply: () => Promise<boolean>;
  storage?: IncomingReviewStorage;
  now?: () => Date;
}): IncomingChangeReview {
  const receipt = useMemo(
    () => (active ? getIncomingChangeReceipt(status) : null),
    [active, status],
  );
  const [decisions, setDecisions] = useState<SetAsideReceipt[]>([]);
  const [applying, setApplying] = useState(false);
  const [failedReceiptId, setFailedReceiptId] = useState<string | null>(null);
  const applyingRef = useRef(false);

  useEffect(() => {
    // The established path must not even read the ledger, so loading waits for
    // the experience to be switched on.
    setDecisions(active ? readSetAsideReceipts(storage) : []);
  }, [active, storage]);

  const setAside = useCallback(() => {
    if (!receipt) return;
    setDecisions((current) => setAsideReceipt(storage, current, receipt.id, now().toISOString()));
  }, [now, receipt, storage]);

  const restore = useCallback(() => {
    if (!receipt) return;
    setDecisions((current) => restoreReceipt(storage, current, receipt.id));
  }, [receipt, storage]);

  const apply = useCallback(() => {
    if (!receipt?.canApply || applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    setFailedReceiptId(null);
    void onApply()
      .then((applied) => setFailedReceiptId(applied ? null : receipt.id))
      .catch(() => setFailedReceiptId(receipt.id))
      .finally(() => {
        applyingRef.current = false;
        setApplying(false);
      });
  }, [onApply, receipt]);

  return {
    state: resolveState({ active, receipt, decisions }),
    receipt,
    applying,
    applyFailed: Boolean(receipt && failedReceiptId === receipt.id),
    apply,
    setAside,
    restore,
  };
}

function resolveState({ active, receipt, decisions }: {
  active: boolean;
  receipt: IncomingChangeReceipt | null;
  decisions: readonly SetAsideReceipt[];
}): IncomingChangeReviewState {
  if (!active) return "inactive";
  if (!receipt) return "none";
  return isSetAside(decisions, receipt.id) ? "set-aside" : "pending";
}

/** Stable identity: a new object per render would restart the ledger effect. */
const unavailableStorage: IncomingReviewStorage = { getItem: () => null, setItem: () => undefined };

function defaultStorage(): IncomingReviewStorage {
  return typeof window === "undefined" ? unavailableStorage : window.localStorage;
}
