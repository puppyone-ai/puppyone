import { useCallback } from "react";
import type { RightSidebarSurface } from "../../preferenceStorage";

type GitSurface = "changes" | "history";

/** Routes the Header Git action and History navigation through the right sidebar. */
export function useGitPresentation({
  workspaceScope,
  sidebarOpen,
  sidebarSurface,
  setSidebarOpen,
  setSidebarSurface,
  onReveal,
  beforeOpenSidebar,
}: {
  workspaceScope: string | null;
  sidebarOpen: boolean;
  sidebarSurface: RightSidebarSurface;
  setSidebarOpen: (open: boolean) => void;
  setSidebarSurface: (surface: RightSidebarSurface) => void;
  onReveal: () => void;
  beforeOpenSidebar: () => void;
}) {
  const sidebarShowsGit = sidebarSurface === "changes" || sidebarSurface === "history";
  const open = workspaceScope !== null && sidebarOpen && sidebarShowsGit;

  const reveal = useCallback((next: GitSurface) => {
    if (!workspaceScope) return;
    beforeOpenSidebar();
    setSidebarSurface(next);
    setSidebarOpen(true);
    onReveal();
  }, [beforeOpenSidebar, onReveal, setSidebarOpen, setSidebarSurface, workspaceScope]);
  const toggle = useCallback(() => {
    if (open) {
      setSidebarOpen(false);
      return;
    }
    reveal("changes");
  }, [open, reveal, setSidebarOpen]);
  const openHistory = useCallback(() => reveal("history"), [reveal]);
  const backToChanges = useCallback(() => reveal("changes"), [reveal]);

  return {
    open,
    changesActive: open && sidebarSurface === "changes",
    historyActive: open && sidebarSurface === "history",
    toggle,
    openHistory,
    backToChanges,
  };
}
