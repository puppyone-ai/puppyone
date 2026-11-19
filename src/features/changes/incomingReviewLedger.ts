/**
 * The review decision is the only part of a receipt worth persisting: the
 * changes themselves stay in the repository until the user applies them.
 *
 * Setting a receipt aside must therefore outlive the window, the session and
 * the application, and it must never touch the remote facts — a receipt that
 * came back after a restart, or a decision that deleted the changes, would both
 * break the promise this surface exists to make.
 */
export type IncomingReviewStorage = Pick<Storage, "getItem" | "setItem">;

export type SetAsideReceipt = {
  id: string;
  /** When the user set it aside, so the ledger can stay bounded by age. */
  at: string;
};

export const INCOMING_REVIEW_STORAGE_KEY = "puppyone.changes.incoming-review.v1";

/** Decisions are per receipt identity; a bounded ledger cannot grow forever. */
const LEDGER_LIMIT = 50;

export function readSetAsideReceipts(storage: IncomingReviewStorage): SetAsideReceipt[] {
  try {
    const raw = storage.getItem(INCOMING_REVIEW_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSetAsideReceipt).slice(0, LEDGER_LIMIT);
  } catch {
    // A damaged ledger must not hide a pending review: fall back to showing it.
    return [];
  }
}

export function isSetAside(receipts: readonly SetAsideReceipt[], id: string): boolean {
  return receipts.some((receipt) => receipt.id === id);
}

export function setAsideReceipt(
  storage: IncomingReviewStorage,
  receipts: readonly SetAsideReceipt[],
  id: string,
  at: string,
): SetAsideReceipt[] {
  return write(storage, [{ id, at }, ...receipts.filter((receipt) => receipt.id !== id)]);
}

export function restoreReceipt(
  storage: IncomingReviewStorage,
  receipts: readonly SetAsideReceipt[],
  id: string,
): SetAsideReceipt[] {
  return write(storage, receipts.filter((receipt) => receipt.id !== id));
}

function write(storage: IncomingReviewStorage, receipts: SetAsideReceipt[]): SetAsideReceipt[] {
  const bounded = receipts.slice(0, LEDGER_LIMIT);
  try {
    storage.setItem(INCOMING_REVIEW_STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // Storage is unavailable; the decision still holds for this session.
  }
  return bounded;
}

function isSetAsideReceipt(value: unknown): value is SetAsideReceipt {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<SetAsideReceipt>;
  return typeof record.id === "string" && record.id.length > 0 && typeof record.at === "string";
}
