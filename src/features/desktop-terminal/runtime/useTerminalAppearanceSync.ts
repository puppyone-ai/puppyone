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
    void document.fonts?.ready.then(applyAppearance);

    return () => {
      disposed = true;
      unsubscribeTypography();
    };
  }, [revision, runtime, readAppearance]);
}
