import { useEffect, useRef } from "react";

/** Keep keyboard navigation inside a popover when its list/detail is replaced. */
export function useGitViewNavigationFocus(enabled: boolean, detailVisible: boolean) {
  const rootRef = useRef<HTMLElement>(null);
  const previousDetail = useRef(detailVisible);
  useEffect(() => {
    if (enabled && previousDetail.current !== detailVisible) {
      rootRef.current?.querySelector<HTMLElement>(".desktop-git-view-header button:not([disabled])")
        ?.focus({ preventScroll: true });
    }
    previousDetail.current = detailVisible;
  }, [detailVisible, enabled]);
  return rootRef;
}
