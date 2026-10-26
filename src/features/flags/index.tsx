import { createContext, useContext, type ReactNode } from "react";
import { useDesktopPreference } from "../../preferencesStore";
import localFlags from "./flags.json";

const FEATURE_FLAG_DEFAULTS = {
  cloudWorkspace: true,
  cloudBilling: false,
  assetLibraryHome: false,
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAG_DEFAULTS;
export type FeatureFlags = Record<FeatureFlagKey, boolean>;

type LocalFeatureFlags = Partial<Record<FeatureFlagKey, unknown>>;

export function resolveFeatureFlags(flags: LocalFeatureFlags = localFlags): FeatureFlags {
  return Object.fromEntries(
    Object.entries(FEATURE_FLAG_DEFAULTS).map(([key, defaultValue]) => {
      const flagKey = key as FeatureFlagKey;
      const value = flags[flagKey];
      return [flagKey, typeof value === "boolean" ? value : defaultValue];
    }),
  ) as FeatureFlags;
}

const FeatureFlagsContext = createContext<FeatureFlags>(resolveFeatureFlags());

export function FeatureFlagsProvider({
  children,
  value = resolveFeatureFlags(),
}: {
  children: ReactNode;
  value?: FeatureFlags;
}) {
  return (
    <FeatureFlagsContext.Provider value={value}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlag(key: FeatureFlagKey): boolean {
  return useContext(FeatureFlagsContext)[key];
}

/**
 * Whether this build offers a PuppyOne account: the Account page in Settings,
 * session restore, and PuppyOne's own model compute (balance, trial credit and
 * top-up, when payments are on).
 *
 * An account is not Cloud. Many people hold one only for the compute they buy
 * on the website and use in the Desktop, so the account never waits for the
 * Cloud experiment. What waits is everything about the Cloud Computer: see
 * useCloudEnabled().
 */
export function useAccountAvailable(): boolean {
  return useFeatureFlag("cloudWorkspace");
}

/**
 * Whether PuppyOne Cloud is on in this window: the build ships it and the user
 * has turned on the Cloud experiment in Settings.
 *
 * Cloud projects, the Cloud Computer and its Plan, sharing, the first-run
 * sign-in screen, the Homepage Cloud status and marketplace template links
 * follow this decision. While it is off the Desktop is local-first about
 * projects, but the PuppyOne account and its compute stay available
 * (useAccountAvailable()).
 */
export function useCloudEnabled(): boolean {
  const available = useAccountAvailable();
  const enabled = useDesktopPreference((state) => state.experimentalSettings.enableCloudWorkspace);
  return available && enabled;
}
