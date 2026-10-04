import { useCallback, useEffect, useState } from "react";
import type { RightSidebarSurface } from "../../preferenceStorage";

type GitSurface = "changes" | "history";

/** Selects a presentation for the existing Git controller, scoped to one project. */
export function useGitPresentation({
  centeredProject,
  cardExperiment,
  workspaceScope,
  sidebarOpen,
  sidebarSurface,
  setSidebarOpen,
  setSidebarSurface,
  onReveal,
  beforeOpenSidebar,
}: {
  centeredProject: boolean;
  cardExperiment: boolean;
  workspaceScope: string | null;
  sidebarOpen: boolean;
  sidebarSurface: RightSidebarSurface;
  setSidebarOpen: (open: boolean) => void;
  setSidebarSurface: (surface: RightSidebarSurface) => void;
  onReveal: () => void;
  beforeOpenSidebar: () => void;
}) {
  const cardEnabled = centeredProject && cardExperiment;
  const [card, setCard] = useState<{ scope: string; surface: GitSurface } | null>(null);
  const cardOpen = cardEnabled && workspaceScope !== null && card?.scope === workspaceScope;
  const cardSurface = cardOpen ? card.surface : "changes";
  const sidebarShowsGit = sidebarSurface === "changes" || sidebarSurface === "history";
  const effectiveSidebarOpen = sidebarOpen && !(cardEnabled && sidebarShowsGit);
  const surface = cardEnabled ? cardSurface : sidebarSurface;
  const open = cardEnabled ? cardOpen : sidebarOpen && sidebarShowsGit;

  useEffect(() => {
    setCard(null);
  }, [cardEnabled, workspaceScope]);

  useEffect(() => {
    // Enabling the experiment retires only an open Git sidebar, preserving Chat.
    if (cardEnabled && sidebarOpen && sidebarShowsGit) setSidebarOpen(false);
  }, [cardEnabled, setSidebarOpen, sidebarOpen, sidebarShowsGit]);

  const closeCard = useCallback(() => setCard(null), []);
  const reveal = useCallback((next: GitSurface) => {
    if (!workspaceScope) return;
    if (cardEnabled) {
      setCard({ scope: workspaceScope, surface: next });
    } else {
      beforeOpenSidebar();
      setSidebarSurface(next);
      setSidebarOpen(true);
    }
    onReveal();
  }, [beforeOpenSidebar, cardEnabled, onReveal, setSidebarOpen, setSidebarSurface, workspaceScope]);
  const toggle = useCallback(() => {
    if (open) {
      if (cardEnabled) closeCard();
      else setSidebarOpen(false);
      return;
    }
    reveal("changes");
  }, [cardEnabled, closeCard, open, reveal, setSidebarOpen]);
  const openHistory = useCallback(() => reveal("history"), [reveal]);
  const backToChanges = useCallback(() => reveal("changes"), [reveal]);

  return {
    cardEnabled,
    cardOpen,
    cardSurface,
    closeCard,
    effectiveSidebarOpen,
    open,
    changesActive: open && surface === "changes",
    historyActive: open && surface === "history",
    toggle,
    openHistory,
    backToChanges,
  };
}
