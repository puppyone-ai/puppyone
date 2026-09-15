import type { DragEvent } from "react";
import { localResourceFileUrl } from "../../../shared/workspace-resource-reference.mjs";

/** Export one registered local Project as a Finder-compatible folder drag. */
export function beginProjectRootDrag(
  event: DragEvent<HTMLElement>,
  projectPath: string,
  onFailure?: () => void,
): boolean {
  const absolutePath = projectPath.trim();
  if (!absolutePath) {
    event.preventDefault();
    return false;
  }

  try {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", absolutePath);
    event.dataTransfer.setData("text/uri-list", localResourceFileUrl(absolutePath));

    const startNativeDrag = window.puppyoneDesktop?.startProjectRootDrag;
    if (window.puppyoneDesktop?.resourceDragSessionSupported && startNativeDrag) {
      event.preventDefault();
      void startNativeDrag({ path: absolutePath })
        .then((started) => { if (!started) onFailure?.(); })
        .catch(() => onFailure?.());
    }
    return true;
  } catch {
    event.preventDefault();
    onFailure?.();
    return false;
  }
}
