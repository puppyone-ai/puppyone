import { createContext, useContext, type ReactNode } from "react";
import type { ShareTargetId } from "./shareTargets";
import type { ProjectSharesState } from "./useProjectShares";

/**
 * Share actions the experimental onboarding exposes to Cloud surfaces. `null`
 * means the experiment is off and surfaces must render their existing layout.
 */
export type CloudShareActions = Readonly<{
  shares: ProjectSharesState;
  openShare: (targetId: ShareTargetId | null, path?: string) => void;
}>;

const CloudShareContext = createContext<CloudShareActions | null>(null);

export function CloudShareProvider({
  value,
  children,
}: {
  value: CloudShareActions | null;
  children: ReactNode;
}) {
  return <CloudShareContext.Provider value={value}>{children}</CloudShareContext.Provider>;
}

export function useCloudShare(): CloudShareActions | null {
  return useContext(CloudShareContext);
}
