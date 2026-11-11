import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FolderStatus } from "../../../types/electron";

/**
 * Whether each of these project folders can be opened now, asked of Main when they are
 * first shown, whenever the window comes back to the front (a disk plugged in again, a
 * folder put back) and when something fails to read them. Folders that are fine are
 * left out, so the result is what needs saying.
 */
export function useFolderAvailability(paths: readonly string[], enabled = true) {
  const [unavailable, setUnavailable] = useState<ReadonlyMap<string, FolderStatus>>(new Map());
  const key = paths.join("\n");
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const bridge = window.puppyoneDesktop;
    if (!enabled || !bridge?.getFolderStatus || !key) {
      setUnavailable((current) => (current.size ? new Map() : current));
      return;
    }
    const request = ++generation.current;
    const statuses = await bridge.getFolderStatus(key.split("\n")).catch(() => null);
    if (!statuses || request !== generation.current) return;
    setUnavailable((current) => {
      const next = new Map(statuses.filter((status) => status.state !== "available").map((status) => [status.path, status]));
      return sameStatuses(current, next) ? current : next;
    });
  }, [enabled, key]);

  useEffect(() => {
    void refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  return useMemo(() => ({ unavailable, refresh }), [unavailable, refresh]);
}

function sameStatuses(left: ReadonlyMap<string, FolderStatus>, right: ReadonlyMap<string, FolderStatus>) {
  if (left.size !== right.size) return false;
  for (const [folderPath, status] of right) {
    const other = left.get(folderPath);
    if (!other || other.state !== status.state || other.suggestion?.token !== status.suggestion?.token) return false;
  }
  return true;
}
