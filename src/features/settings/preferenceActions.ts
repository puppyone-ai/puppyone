import type { StateCreator } from "zustand/vanilla";
import type { DesktopPreferenceState, PreferenceUpdate } from "./preferenceTypes";
export type PreferenceSlice<T> = StateCreator<DesktopPreferenceState, [], [], T>;
export function applyPreferenceUpdate<T>(update: PreferenceUpdate<T>, current: T): T {
  return typeof update === "function" ? (update as (current: T) => T)(current) : update;
}
