import { useEffect, useState } from "react";
import type { DocumentSessionStatus } from "./types";

/** A background save shorter than this is never announced. */
export const SLOW_SAVE_INDICATOR_MS = 1500;

/**
 * Presentation of a Working Copy status. Automatic saves run in the background:
 * while one is in flight the document simply still has unsaved changes, and it
 * becomes clean when the write lands. Only a save slower than the threshold
 * shows "saving" and, afterwards, "saved". Explicit saves (`quiet = false`)
 * report every state at once. Errors are never hidden.
 */
export function useVisibleSaveStatus(
  status: DocumentSessionStatus,
  quiet = true,
  slowAfterMs = SLOW_SAVE_INDICATOR_MS,
): DocumentSessionStatus {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!quiet) return undefined;
    if (status === "saving") {
      const timer = setTimeout(() => setSlow(true), slowAfterMs);
      return () => clearTimeout(timer);
    }
    // "saved" keeps the flag so a slow save can confirm its completion.
    if (status !== "saved") setSlow(false);
    return undefined;
  }, [quiet, slowAfterMs, status]);

  if (!quiet) return status;
  if (status === "saving") return slow ? "saving" : "dirty";
  if (status === "saved") return slow ? "saved" : "clean";
  return status;
}
