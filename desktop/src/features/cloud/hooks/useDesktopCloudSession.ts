import { useCallback, useEffect, useState } from "react";
import {
  clearDesktopCloudSession,
  getCachedDesktopCloudSession,
  onDesktopCloudSessionChanged,
  restoreDesktopCloudSession,
  type DesktopCloudSession,
} from "../../../lib/cloudSession";

export function useDesktopCloudSession() {
  const [cloudSession, setCloudSession] = useState<DesktopCloudSession | null>(() => getCachedDesktopCloudSession());
  const [cloudSessionRestoring, setCloudSessionRestoring] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onDesktopCloudSessionChanged((session) => {
      if (!cancelled) setCloudSession(session);
    });

    restoreDesktopCloudSession()
      .then((session) => {
        if (cancelled) return;
        setCloudSession(session);
      })
      .catch(() => {
        if (cancelled) return;
        setCloudSession(null);
      })
      .finally(() => {
        if (!cancelled) setCloudSessionRestoring(false);
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const handleCloudSessionChange = useCallback((session: DesktopCloudSession | null) => {
    setCloudSession(session);
    if (!session) {
      void clearDesktopCloudSession().catch(() => {
        setCloudSession(null);
      });
    }
  }, []);

  return {
    cloudSession,
    cloudSessionRestoring,
    handleCloudSessionChange,
  };
}
