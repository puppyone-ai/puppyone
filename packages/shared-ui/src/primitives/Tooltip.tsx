import { cloneElement, type ReactElement } from "react";

export type TooltipPlacement = "bottom" | "top" | "right" | "left";

export type TooltipProps = {
  children: ReactElement<Record<string, unknown>>;
  content: string | null | undefined;
  overflowOnly?: boolean;
  placement?: TooltipPlacement;
  shortcut?: string | null;
};

/**
 * The only tooltip activation API: callers explicitly wrap the intended control.
 * UI primitives never infer hints from labels or accept a tooltip prop. This
 * adds no layout wrapper; visible labels and accessibility names do not opt in.
 */
export function Tooltip({
  children,
  content,
  overflowOnly = false,
  placement,
  shortcut,
}: TooltipProps) {
  const normalizedContent = content?.trim();
  if (!normalizedContent) return children;

  return cloneElement(children, {
    "data-tooltip": normalizedContent,
    "data-tooltip-placement": placement,
    "data-tooltip-shortcut": shortcut?.trim() || undefined,
    "data-tooltip-when": overflowOnly ? "overflow" : undefined,
  });
}

/** Disable hover/focus hint bubbles for an entire surface, including nested controls. */
export function disableTooltipHints(element: HTMLElement) {
  element.dataset.tooltipDisabled = "true";
}

export function isTooltipSuppressed(element: Element): boolean {
  return element.closest('[data-tooltip-disabled="true"]') !== null;
}
