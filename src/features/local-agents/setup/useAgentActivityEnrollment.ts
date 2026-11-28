import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentActivityEnrollmentSnapshot } from "../../../../shared/agent-activity-contract/types";

const EMPTY_ENROLLED_PROVIDERS: ReadonlySet<string> = new Set();

/**
 * Reads Main-owned Agent activity enrollment once on mount and again when the
 * window regains focus, so settings and the Homepage share one read boundary.
 */
export function useAgentActivityEnrollment({ enabled = true }: { enabled?: boolean } = {}) {
  const [snapshot, setSnapshot] = useState<AgentActivityEnrollmentSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const read = window.puppyoneDesktop?.getAgentActivityEnrollment;
    if (!enabled || !read) {
      setSnapshot(null);
      setLoading(false);
      setError(null);
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await read();
      setSnapshot(next);
      return next;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return null;
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setSnapshot(null);
      setLoading(false);
      setError(null);
      return undefined;
    }
    let active = true;
    const refresh = () => {
      const read = window.puppyoneDesktop?.getAgentActivityEnrollment;
      if (!read) return;
      void read()
        .then((next) => {
          if (!active) return;
          setSnapshot(next);
          setError(null);
        })
        .catch((failure: unknown) => {
          if (!active) return;
          setError(failure instanceof Error ? failure.message : String(failure));
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [enabled]);

  const enabledProviderIds = useMemo(() => {
    if (!snapshot) return EMPTY_ENROLLED_PROVIDERS;
    const enrolled = snapshot.providers
      .filter((provider) => provider.enrollment === "enabled")
      .map((provider) => provider.providerId);
    return enrolled.length > 0 ? new Set(enrolled) : EMPTY_ENROLLED_PROVIDERS;
  }, [snapshot]);

  return useMemo(() => ({
    snapshot,
    enabledProviderIds,
    loading,
    error,
    reload,
  }), [enabledProviderIds, error, loading, reload, snapshot]);
}
