import type { ReactNode } from "react";

/**
 * Who can open a project, in the three audiences the Homepage groups by: this
 * computer, all my devices, and a team. The Cloud is not a fourth audience but
 * one way to reach one: a folder is opened to my other computers directly, and
 * reaches a team only as a copy in the Cloud, which is its own project
 * (puppy-issues ADR-001) and gets this folder's changes only when they are sent.
 *
 * The Header's place menu and the Homepage's project menu read the same shape,
 * so the two can never describe one project differently.
 */
export type ProjectAudience = Readonly<{
  /** Absent where opening folders to my other computers is not available. */
  devices?: DevicesAudience;
  /** A copy of this folder in my own Cloud space, which my devices can also open. */
  devicesCopy?: CloudCopy | null;
  /** Absent where no team can take a project. */
  team?: TeamAudience;
}>;

export type DevicesAudience = Readonly<{
  /** This folder itself is open to my other computers. */
  on: boolean;
  /** Who can open it, or how, once it is on. */
  detail?: ReactNode;
  onTurnOn?: () => void;
  onStop?: () => void;
  onSettings?: () => void;
}>;

export type TeamAudience = Readonly<{
  copy: CloudCopy | null;
  /** Copies this folder to a team's Cloud space; absent where it cannot be offered. */
  onCopy?: () => void;
}>;

export type CloudCopy = Readonly<{
  /** Opens the copy; absent where it cannot be opened from here. */
  onOpen?: () => void;
  /** Why the copy cannot be used as it is, in the user's words. */
  problem?: string;
  /** Acts on the problem, such as checking again or signing in. */
  onResolve?: () => void;
  resolveLabel?: string;
  /** Commits here that the copy has not had yet. */
  unsent?: number;
  onSend?: () => void;
}>;

/** Only this computer: nothing else reaches the project. */
export function reachesOnlyThisComputer(audience: ProjectAudience): boolean {
  return !audience.devices?.on && !audience.devicesCopy && !audience.team?.copy;
}

/** There is something to say about who can open the project beyond this computer. */
export function hasProjectAudience(audience: ProjectAudience | null | undefined): audience is ProjectAudience {
  return Boolean(audience && (audience.devices || audience.devicesCopy || audience.team));
}
