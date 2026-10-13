/**
 * What the Header says about the current project when the project reach
 * experience is on: where the project is, and who can reach it.
 *
 * Position is a fact, so the place is stated and never selected: a project
 * sitting on this computer says so, and a project whose working copy lives on
 * a Cloud workspace says that instead. Reach is the second half of the same
 * statement, so "only you, on this Mac" is a complete answer rather than an
 * empty control.
 *
 * Position is a fact, so nothing here is selectable and nothing here persuades.
 * The established path keeps the local / Cloud tabs; this module exists so the
 * new path can state reach from facts the product already has — the shares
 * list, whether the first read arrived, whether the project context needs
 * attention — without inventing a second data layer.
 *
 * Contract: puppy-issues
 * `document/puppyone-desktop/platform/experimental-path-forks.md`.
 */

/** A person is invited and reads; everything else is a machine put to work. */
export type ReachAudience = "person" | "machine";

/**
 * Where the project the Header is talking about actually sits. The product
 * knows this already; stating it is what keeps "only you" from reading as
 * "nothing here". It is never a choice: a user who works out of a Cloud
 * workspace sees the Cloud place for the same reason a laptop user sees theirs.
 */
export type ReachPlace = "this-device" | "cloud";

/**
 * Mirrors the Agent file-presence contract (`reading` / `writing`) so an active
 * destination can be stated as activity instead of a residency claim. The
 * presence domain owns the facts; this is only how the Header renders them.
 */
export type ReachActivityKind = "reading" | "writing";

export type ReachActivity = Readonly<{ kind: ReachActivityKind; label: string }>;

/** The share facts the Header needs. Structurally a subset of `ProjectShare`. */
export type ReachShareFact = Readonly<{
  id: string;
  name: string;
  lastSeenAt: string | null;
}>;

/** Destination vocabulary, supplied by the share domain through the caller. */
export type ReachDestination = Readonly<{
  id: string;
  /** Proper nouns stay untranslated, so they identify a destination in any locale. */
  brand: string | null;
  label: string;
}>;

/** Mirrors `CloudShareStatusKind`; the caller passes the resolved status. */
export type ReachShareKind =
  | "local"
  | "signed-out"
  | "resolving"
  | "published"
  | "shared"
  | "waiting"
  | "attention";

export type ReachMember = Readonly<{
  id: string;
  name: string;
  audience: ReachAudience;
  lastSeenAt: string | null;
  activity: ReachActivity | null;
}>;

/**
 * The six things the Header can state. Every one of them is a fact about
 * reach; none of them is a prompt to share.
 */
export type ReachStateKind =
  | "only-you"
  | "reachable"
  | "waiting"
  | "working"
  | "attention"
  | "not-on-this-device";

export type ReachState = Readonly<{
  kind: ReachStateKind;
  /** Where this project is, stated beside who can reach it. */
  place: ReachPlace;
  members: readonly ReachMember[];
  people: number;
  machines: number;
  /** The destination still waiting for its first read, when one is. */
  waitingFor: string | null;
  /** The reader whose version is the freshest fact worth stating on hover. */
  freshest: ReachMember | null;
  /**
   * Emphasis is reserved for something the user has to deal with: no
   * connection, a failed publication, reach that was taken away. A project
   * nobody reaches is quiet, not unfinished.
   */
  emphasis: boolean;
}>;

const PERSON_DESTINATION_ID = "person";

/**
 * Which kind of destination a share's stored name refers to.
 *
 * The product stores the destination's label as the share name, so brands
 * identify machines in any locale and the person label identifies people in
 * the locale the invite was made in. Anything unrecognized is a machine: a
 * client somebody configured themselves is still a client, and calling it a
 * person would overstate what the product knows.
 */
export function resolveReachAudience(
  name: string,
  destinations: readonly ReachDestination[],
): ReachAudience {
  const candidate = name.trim().toLocaleLowerCase();
  if (!candidate) return "machine";
  for (const destination of destinations) {
    const labels = [destination.brand, destination.label]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim().toLocaleLowerCase());
    if (!labels.some((label) => label && candidate.includes(label))) continue;
    return destination.id === PERSON_DESTINATION_ID ? "person" : "machine";
  }
  return "machine";
}

export function resolveProjectReachState({
  share,
  shares,
  destinations,
  activity = {},
  deviceCopyAvailable = true,
  place = "this-device",
  waitingFor = null,
}: {
  share: ReachShareKind;
  shares: readonly ReachShareFact[];
  destinations: readonly ReachDestination[];
  /** Live reading / writing per share id, when the product knows of any. */
  activity?: Readonly<Record<string, ReachActivity | undefined>>;
  /** False only when the project exists but has no working copy on this device. */
  deviceCopyAvailable?: boolean;
  /** Where the project is being worked on; a missing working copy settles it. */
  place?: ReachPlace;
  /** Destination whose first read has not arrived yet. */
  waitingFor?: string | null;
}): ReachState {
  const members = shares.map((fact) => ({
    id: fact.id,
    name: fact.name,
    audience: resolveReachAudience(fact.name, destinations),
    lastSeenAt: fact.lastSeenAt,
    activity: activity[fact.id] ?? null,
  }));
  const counts = {
    people: members.filter((member) => member.audience === "person").length,
    machines: members.filter((member) => member.audience === "machine").length,
  };
  const base = {
    members,
    ...counts,
    // A project with no working copy here is, by definition, somewhere else.
    place: deviceCopyAvailable ? place : "cloud" as const,
    waitingFor: null,
    freshest: resolveFreshestMember(members),
    emphasis: false,
  };
  if (!deviceCopyAvailable) return { ...base, kind: "not-on-this-device" };
  if (share === "attention") return { ...base, kind: "attention", emphasis: true };
  if (members.some((member) => member.activity)) return { ...base, kind: "working" };
  if (share === "waiting") return { ...base, kind: "waiting", waitingFor: waitingFor ?? resolveWaitingName(members) };
  if (members.length > 0) return { ...base, kind: "reachable" };
  return { ...base, kind: "only-you" };
}

/**
 * The freshness fact is about the other side: the most recent read is the only
 * version the product can honestly say somebody has seen.
 */
function resolveFreshestMember(members: readonly ReachMember[]): ReachMember | null {
  let freshest: ReachMember | null = null;
  let freshestAt = Number.NEGATIVE_INFINITY;
  for (const member of members) {
    if (!member.lastSeenAt) continue;
    const seenAt = Date.parse(member.lastSeenAt);
    if (Number.isNaN(seenAt) || seenAt <= freshestAt) continue;
    freshest = member;
    freshestAt = seenAt;
  }
  return freshest;
}

function resolveWaitingName(members: readonly ReachMember[]): string | null {
  const unread = members.filter((member) => !member.lastSeenAt);
  return unread.at(-1)?.name ?? null;
}

/**
 * The Header's changes entry states this device's own work. Incoming and
 * outgoing counts describe a repository's distance from a remote, which is not
 * a consequence the user acts on; the receipt for changes made elsewhere is
 * owned by the sidebar instead.
 *
 * The established fields stay on the type, so the established path keeps
 * rendering exactly what it rendered before.
 */
export function reachHeaderChangesStatus<T extends {
  conflicts: number;
  incoming: number;
  localChanges: number;
  outgoing: number;
}>(status: T): T {
  if (status.incoming === 0 && status.outgoing === 0) return status;
  return { ...status, incoming: 0, outgoing: 0 };
}
