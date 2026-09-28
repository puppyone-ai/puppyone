import type { CloudMessageDescriptor } from "../cloudPresentation";
import {
  getCloudContextWarning,
  type ProjectCloudContext,
} from "../project/context/projectCloudContext";
import type { ShareTargetId } from "./shareTargets";
import { shareHasReceipt, type ProjectShare } from "./useProjectShares";

/**
 * A share that was just issued and has not been read yet. The desktop keeps it
 * after the Share dialog closes so the Header can keep saying "Waiting for
 * Viktor…" until the first read arrives.
 */
export type PendingShare = Readonly<{
  targetId: ShareTargetId;
  endpointId: string;
  issuedAt: string;
}>;

export type CloudShareStatusKind =
  | "local"
  | "signed-out"
  | "resolving"
  | "published"
  | "shared"
  | "waiting"
  | "attention";

export type CloudShareStatus = Readonly<{
  kind: CloudShareStatusKind;
  /** Agents that can read the project right now. */
  readers: readonly ProjectShare[];
  pending: PendingShare | null;
  /** Why Cloud needs attention, when the project context explains it. */
  message: CloudMessageDescriptor | null;
}>;

/** One status for the Header label, its popover, and the Cloud Homepage. */
export function resolveCloudShareStatus({
  context,
  shares,
  sharesLoaded = true,
  signedIn,
  pending,
}: {
  context: ProjectCloudContext;
  shares: readonly ProjectShare[];
  /** Until the first list arrives, a published project must not claim "nobody can read it". */
  sharesLoaded?: boolean;
  signedIn: boolean;
  pending: PendingShare | null;
}): CloudShareStatus {
  const readers = shares.filter(isActiveShare);
  const base = { readers, pending: null, message: null };
  if (context.status === "local-only") return { ...base, kind: "local" };
  if (!signedIn) return { ...base, kind: "signed-out" };
  if (context.status === "resolving") return { ...base, kind: "resolving" };
  if (context.status === "resolved") {
    if (!sharesLoaded) return { ...base, kind: "resolving" };
    if (pending && isPendingShareLive(pending, shares)) return { ...base, kind: "waiting", pending };
    return { ...base, kind: readers.length > 0 ? "shared" : "published" };
  }
  return { ...base, kind: "attention", message: getCloudContextWarning(context) };
}

export function isActiveShare(share: ProjectShare): boolean {
  return share.status !== "disabled";
}

/** Still worth waiting for: the share exists, is active, and has not been read since it was issued. */
export function isPendingShareLive(pending: PendingShare, shares: readonly ProjectShare[]): boolean {
  const share = shares.find((candidate) => candidate.id === pending.endpointId);
  return Boolean(share && isActiveShare(share) && !shareHasReceipt(share, pending.issuedAt));
}
