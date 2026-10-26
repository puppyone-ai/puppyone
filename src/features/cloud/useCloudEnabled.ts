import { useDesktopPreference } from "../../preferencesStore";
import { useFeatureFlag } from "../flags";

/**
 * Whether PuppyOne Cloud is on in this window: the build ships it and the user
 * has turned on the Cloud experiment in Settings.
 *
 * Everything that needs a PuppyOne account follows this one decision: sign-in,
 * the Account page, marketplace template links, paid compute and session
 * restore. While it is off the Desktop is local-first: it shows no sign-in and
 * never contacts PuppyOne Cloud.
 */
export function useCloudEnabled(): boolean {
  const available = useFeatureFlag("cloudWorkspace");
  const enabled = useDesktopPreference((state) => state.experimentalSettings.enableCloudWorkspace);
  return available && enabled;
}
