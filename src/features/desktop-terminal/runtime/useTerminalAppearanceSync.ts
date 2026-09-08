import { useLayoutEffect, type RefObject } from "react";
import { subscribeTypographyChanges } from "@puppyone/shared-ui";

type TerminalAppearanceRegistry = Readonly<{
  applyAppearance: () => void;
}>;

export function useTerminalAppearanceSync(
  panelRef: RefObject<HTMLElement | null>,
  runtimeRegistry: TerminalAppearanceRegistry,
) {
  useLayoutEffect(() => {
    let disposed = false;
    const applyAppearance = () => {
      if (!disposed) runtimeRegistry.applyAppearance();
    };
    const shell = panelRef.current?.closest(".app-shell");
    applyAppearance();

    const shellObserver = shell ? new MutationObserver(applyAppearance) : null;
    shellObserver?.observe(shell as Element, {
      attributes: true,
      attributeFilter: [
        "class",
        "style",
        "data-theme-mode",
        "data-sub-theme-id",
        "data-light-theme-preset",
        "data-dark-theme-preset",
        "data-font-terminal",
      ],
    });
    const styleObserver = new MutationObserver(applyAppearance);
    styleObserver.observe(document.head, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["href", "style"],
    });
    const unsubscribeTypography = subscribeTypographyChanges(document, applyAppearance);
    void document.fonts?.ready.then(applyAppearance);

    return () => {
      disposed = true;
      shellObserver?.disconnect();
      styleObserver.disconnect();
      unsubscribeTypography();
    };
  }, [panelRef, runtimeRegistry]);
}
