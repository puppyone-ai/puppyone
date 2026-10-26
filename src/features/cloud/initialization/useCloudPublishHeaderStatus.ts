import { useCallback, useEffect, useState } from "react";
import type {
  CloudInitializationProgress,
  CloudPublishProgressStage,
  CloudPublishTransfer,
} from "../../../types/electron";
import type { CloudInitializationOutcome } from "./useCloudInitialization";

/** What the Header says about a first publish the user is not watching. */
export type CloudPublishHeaderStatus =
  | Readonly<{ kind: "running"; stage: CloudPublishProgressStage; transfer?: CloudPublishTransfer }>
  | Readonly<{ kind: "completed" }>
  | Readonly<{ kind: "attention" }>
  /** Unfinished. `discard`: the user chose Discard and the deletion did not finish. */
  | Readonly<{ kind: "paused"; stage: CloudPublishProgressStage; discard?: boolean }>;

/** Long enough to notice after looking back at the window, short enough not to linger. */
export const CLOUD_PUBLISH_COMPLETED_VISIBLE_MS = 8000;

/**
 * The publish keeps running after its dialog closes, so the Header carries it
 * from there: progress while it runs, then how it ended.
 *
 * A running send is always stated, including while a surface that shows the
 * run is open. Retrying restarts the whole send, and a Header that kept
 * showing the warning, or went blank, while files were moving would say the
 * opposite of what is happening. The spinner is the one statement that is
 * true for the whole run, wherever the user is looking.
 *
 * Endings are different: while a surface that shows the run is open, that
 * surface already states how it ended, so the Header stays quiet. An ending is
 * stated once: opening the run again, clicking the Header, or (for a success)
 * a short delay retires it. A failure stays until the user looks, because the
 * project is waiting on them.
 *
 * A publish that stopped unfinished, in this window or before the app last
 * quit, stays stated for as long as it stays unfinished (as `paused`, drawn as
 * a warning: nobody paused it, it was interrupted). The way to clear it is to
 * retry it or delete the empty Cloud project.
 */
export function useCloudPublishHeaderStatus({ progress, outcome, pausedStage = null, pausedDiscard = false, surfaceOpen }: {
  progress: CloudInitializationProgress | null;
  outcome: CloudInitializationOutcome | null;
  /** Where an unfinished publish stopped, from its saved state; null when there is none. */
  pausedStage?: CloudPublishProgressStage | null;
  /** The unfinished work is a Discard, not a send, so the Header must not offer a retry. */
  pausedDiscard?: boolean;
  /** A dialog that shows the run, or its ending, is on screen. Hides endings, never a running send. */
  surfaceOpen: boolean;
}): { status: CloudPublishHeaderStatus | null; acknowledge: () => void } {
  const [seen, setSeen] = useState<CloudInitializationOutcome | null>(null);

  useEffect(() => {
    if (outcome && surfaceOpen) setSeen(outcome);
  }, [outcome, surfaceOpen]);

  useEffect(() => {
    if (outcome?.kind !== "published") return undefined;
    const timer = window.setTimeout(() => setSeen(outcome), CLOUD_PUBLISH_COMPLETED_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [outcome]);

  const acknowledge = useCallback(() => setSeen(outcome), [outcome]);

  let status: CloudPublishHeaderStatus | null = null;
  if (progress) status = { kind: "running", stage: progress.stage, transfer: progress.transfer };
  else if (surfaceOpen) status = null;
  else if (outcome && outcome !== seen) status = { kind: outcome.kind === "published" ? "completed" : "attention" };
  else if (pausedStage) status = { kind: "paused", stage: pausedStage, discard: pausedDiscard || undefined };
  return { status, acknowledge };
}
