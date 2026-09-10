import { useEffect, useRef } from "react";

export type InteractionTerminationReason =
  | "blur"
  | "dragend"
  | "drop"
  | "escape"
  | "hidden"
  | "pagehide"
  | "unmount";

export type UseInteractionTerminationOptions = Readonly<{
  blurGraceMs?: number;
  finish: (reason: InteractionTerminationReason) => boolean;
  includeHtmlDragEvents?: boolean;
}>;

/** Installs one renderer lifecycle boundary for a pointer or drag session. */
export function useInteractionTermination({
  blurGraceMs = 0,
  finish,
  includeHtmlDragEvents = false,
}: UseInteractionTerminationOptions): void {
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    let blurTimer: number | null = null;
    const clearBlurTimer = () => {
      if (blurTimer === null) return;
      window.clearTimeout(blurTimer);
      blurTimer = null;
    };
    const terminate = (reason: InteractionTerminationReason) => {
      finishRef.current(reason);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (finishRef.current("escape")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") terminate("hidden");
    };
    const handleBlur = () => {
      if (blurGraceMs <= 0) {
        terminate("blur");
        return;
      }
      clearBlurTimer();
      blurTimer = window.setTimeout(() => {
        blurTimer = null;
        terminate("blur");
      }, blurGraceMs);
    };
    const handleFocus = () => clearBlurTimer();
    const handlePageHide = () => terminate("pagehide");
    const handleDragEnd = () => terminate("dragend");
    const handleDrop = () => terminate("drop");

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", handleBlur, true);
    window.addEventListener("focus", handleFocus, true);
    window.addEventListener("pagehide", handlePageHide, true);
    document.addEventListener("visibilitychange", handleVisibilityChange, true);
    if (includeHtmlDragEvents) {
      window.addEventListener("dragend", handleDragEnd, true);
      window.addEventListener("drop", handleDrop);
    }

    return () => {
      clearBlurTimer();
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("blur", handleBlur, true);
      window.removeEventListener("focus", handleFocus, true);
      window.removeEventListener("pagehide", handlePageHide, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange, true);
      if (includeHtmlDragEvents) {
        window.removeEventListener("dragend", handleDragEnd, true);
        window.removeEventListener("drop", handleDrop);
      }
      terminate("unmount");
    };
  }, [blurGraceMs, includeHtmlDragEvents]);
}
