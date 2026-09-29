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
 * Explicitly opts one control into the product tooltip layer without adding a
 * layout wrapper. Visible labels and accessibility names never activate it.
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

export function activateTooltip(
  element: HTMLElement,
  content: string | null | undefined,
  options: {
    overflowOnly?: boolean;
    placement?: TooltipPlacement;
    shortcut?: string | null;
  } = {},
) {
  const normalizedContent = content?.trim();
  if (!normalizedContent) {
    delete element.dataset.tooltip;
    delete element.dataset.tooltipPlacement;
    delete element.dataset.tooltipShortcut;
    delete element.dataset.tooltipWhen;
    return;
  }

  element.dataset.tooltip = normalizedContent;
  if (options.placement) element.dataset.tooltipPlacement = options.placement;
  else delete element.dataset.tooltipPlacement;
  const shortcut = options.shortcut?.trim();
  if (shortcut) element.dataset.tooltipShortcut = shortcut;
  else delete element.dataset.tooltipShortcut;
  if (options.overflowOnly) element.dataset.tooltipWhen = "overflow";
  else delete element.dataset.tooltipWhen;
}
