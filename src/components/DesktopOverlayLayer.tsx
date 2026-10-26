import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNativeSurfaceOcclusionLease } from "../features/native-surfaces";

const DESKTOP_OVERLAY_ROOT_ID = "desktop-overlay-root";

/** Portals feature-owned menus and dialogs into the shared, themed desktop overlay root. */
export function DesktopOverlayLayer({ children }: { children: ReactNode }) {
  useNativeSurfaceOcclusionLease();
  const root = useDesktopOverlayRoot();
  if (!root) return null;
  return createPortal(children, root);
}

export function useDesktopOverlayRoot() {
  const [root, setRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setRoot(getDesktopOverlayRoot());
  }, []);

  return root;
}

function getDesktopOverlayRoot() {
  const existing = document.getElementById(DESKTOP_OVERLAY_ROOT_ID);
  if (existing instanceof HTMLElement) {
    existing.dataset.poOverlayRoot = "true";
    return existing;
  }

  const root = document.createElement("div");
  root.id = DESKTOP_OVERLAY_ROOT_ID;
  root.className = "desktop-overlay-root";
  root.dataset.poOverlayRoot = "true";
  document.body.appendChild(root);
  return root;
}
