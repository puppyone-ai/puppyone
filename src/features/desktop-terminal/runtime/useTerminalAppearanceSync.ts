import { useLayoutEffect } from "react";
import { subscribeTypographyChanges, useEditorAppearanceRevision } from "@puppyone/shared-ui";
import type { TerminalAppearance } from "./terminalAppearance";
import type { TerminalRuntimeHandle } from "./terminalRuntime";

export function useTerminalAppearanceSync(
  runtime: TerminalRuntimeHandle,
  readAppearance: () => TerminalAppearance,
) {
  const revision = useEditorAppearanceRevision();
  useLayoutEffect(() => {
    let disposed = false;
    const applyAppearance = () => {
      if (!disposed) runtime.applyAppearance(readAppearance());
    };
    // Parent layout effects publish window skin attributes. Read after the
    // complete commit, before paint, rather than observing intermediate DOM.
    queueMicrotask(applyAppearance);
    const unsubscribeTypography = subscribeTypographyChanges(document, applyAppearance);
    const forcedColors = window.matchMedia("(forced-colors: active)");
    forcedColors.addEventListener("change", applyAppearance);
    window.addEventListener("focus", applyAppearance);
    window.addEventListener("blur", applyAppearance);
    void document.fonts?.ready.then(applyAppearance);

    return () => {
      disposed = true;
      unsubscribeTypography();
      forcedColors.removeEventListener("change", applyAppearance);
      window.removeEventListener("focus", applyAppearance);
      window.removeEventListener("blur", applyAppearance);
    };
  }, [revision, runtime, readAppearance]);
}
