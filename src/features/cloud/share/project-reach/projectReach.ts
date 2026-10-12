import type { CloudPublishAccountStep } from "../../initialization/CloudPublishProgressIndicator";
import type { PublishPreparationStage } from "../../initialization/publishPreparation";
import type { CloudPublishProgressStage } from "../../../../types/electron";
import { SHARE_TARGETS, type ShareTarget, type ShareTargetId } from "../shareTargets";

/**
 * The two things a person actually wants: let someone read this, or put an
 * agent to work on it. Everything else on the screen is a detail of one of
 * them, which is why the two screens share a skeleton and differ only in the
 * verb, the object and one sentence.
 */
export type ReachIntent = "invite" | "connect";

/** What the destination may do with what it reaches. */
export type ReachMode = "r" | "rw";

export type ReachScope = Readonly<{ path: string; mode: ReachMode }>;

/**
 * Where the one screen is in its single task. `form` is the screen itself;
 * every other value is the same screen stating what is happening after the
 * user committed to it.
 */
export type ReachPhase =
  | "form"
  | "preparing"
  | "account"
  | "publishing"
  | "issuing"
  | "ready"
  | "failed";

/**
 * A person is invited; everything else is an agent that gets connected. With
 * no destination named yet — a folder's own context menu, say — the screen
 * opens on the invite, because it is the one that needs no choice at all.
 */
export function reachIntentForTarget(id: ShareTargetId | null): ReachIntent {
  return id === null || id === "person" ? "invite" : "connect";
}

export function reachIntentTargets(intent: ReachIntent): readonly ShareTarget[] {
  return SHARE_TARGETS.filter((target) => reachIntentForTarget(target.id) === intent);
}

/** The one destination an invite has: the project itself, read by a person. */
export function inviteReachTarget(): ShareTarget {
  const target = reachIntentTargets("invite")[0];
  if (!target) throw new Error("No invite destination is configured.");
  return target;
}

/**
 * The narrowest honest default: the folder the screen was opened from, read
 * only. Widening to the whole project and allowing changes are both choices
 * the user makes on purpose, never a default they inherit.
 */
export function defaultReachScope(initialPath: string): ReachScope {
  return { path: initialPath, mode: "r" };
}

/**
 * Only destinations that hold their own credential can be given write access.
 * A link is read by whoever opens it, under the permissions they already have,
 * so offering a choice there would be a lie.
 */
export function reachModeSelectable(target: ShareTarget | null): boolean {
  return target?.channel === "mcp";
}

export function reachScopeForTarget(scope: ReachScope, target: ShareTarget | null): ReachScope {
  return reachModeSelectable(target) ? scope : { path: scope.path, mode: "r" };
}

/**
 * Signing in is one step of the progress list, and the step before it needs no
 * account at all.
 */
export function resolveReachAccountStep(phase: ReachPhase): CloudPublishAccountStep {
  if (phase === "preparing") return "pending";
  if (phase === "account") return "active";
  return "done";
}

/**
 * The stage label the progress list shows. Local preparation reports its own
 * stages; the publish reports the rest. Once the publish is done the list is
 * complete and the remaining access work is stated in its own line, rather
 * than borrowing a publish stage that is not running.
 */
export function resolveReachStage({
  phase,
  localStage,
  publishStage,
}: {
  phase: ReachPhase;
  localStage: PublishPreparationStage | null;
  publishStage: CloudPublishProgressStage | null;
}): CloudPublishProgressStage {
  if (phase === "preparing" || phase === "account") return localStage ?? "validating";
  if (phase === "publishing") return publishStage ?? "creating-project";
  return "completed";
}

/** True while the screen is working rather than being filled in. */
export function isReachRunning(phase: ReachPhase): boolean {
  return phase === "preparing" || phase === "account" || phase === "publishing" || phase === "issuing";
}
