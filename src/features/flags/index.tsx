import { createContext, useContext, type ReactNode } from "react";
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
