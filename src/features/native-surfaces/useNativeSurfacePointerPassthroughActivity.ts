import { useCallback, useEffect, useRef } from "react";
import {
  acquireNativeSurfacePointerPassthroughLease,
  type NativeSurfacePointerPassthroughLease,
  type NativeSurfacePointerPassthroughOwner,
} from "./nativeSurfacePointerPassthrough";
import {
  acquireNativeSurfaceLayoutLease,
  type NativeSurfaceLayoutLease,
} from "./nativeSurfaceGeometry";

/** Adapts boolean drag callbacks to a component-owned, idempotent lease. */
export function useNativeSurfacePointerPassthroughActivity(
  owner: NativeSurfacePointerPassthroughOwner,
): (active: boolean) => void {
  const leaseRef = useRef<NativeSurfacePointerPassthroughLease | null>(null);
  const layoutLeaseRef = useRef<NativeSurfaceLayoutLease | null>(null);

  const release = useCallback(() => {
    leaseRef.current?.release();
    leaseRef.current = null;
    layoutLeaseRef.current?.release();
    layoutLeaseRef.current = null;
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") release();
    };
    window.addEventListener("blur", release, true);
    window.addEventListener("pagehide", release, true);
    document.addEventListener("visibilitychange", handleVisibilityChange, true);
    return () => {
      window.removeEventListener("blur", release, true);
      window.removeEventListener("pagehide", release, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange, true);
      release();
    };
  }, [owner, release]);

  return useCallback((active: boolean) => {
    if (!active) {
      release();
      return;
    }
    if (!leaseRef.current) {
      leaseRef.current = acquireNativeSurfacePointerPassthroughLease(owner);
      layoutLeaseRef.current = acquireNativeSurfaceLayoutLease(`${owner}:drag`);
    }
  }, [owner, release]);
}
