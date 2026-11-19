import {
  useCallback,
  useLayoutEffect,
  useState,
  type RefObject,
} from "react";
import { subscribeTypographyChanges } from "./typography";

/** Resolves a CSS custom property through Chromium's layout engine. This is
 * reserved for virtual lists, SVG, and canvas code that needs a numeric copy
 * of geometry otherwise owned by CSS. */
export function resolveCssPixelCustomProperty(
  element: HTMLElement,
  propertyName: `--${string}`,
  fallback: number,
): number {
  const ownerDocument = element.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) return fallback;

  const directValue = ownerWindow.getComputedStyle(element).getPropertyValue(propertyName).trim();
  if (/^-?\d+(?:\.\d+)?px$/.test(directValue)) {
    const parsed = Number.parseFloat(directValue);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const probe = ownerDocument.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.inlineSize = `var(${propertyName}, ${fallback}px)`;
  probe.style.blockSize = "0";
  probe.style.contain = "strict";
  element.appendChild(probe);
  const resolvedValue = ownerWindow.getComputedStyle(probe).inlineSize;
  probe.remove();

  const parsed = Number.parseFloat(resolvedValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function useCssPixelCustomProperty(
  elementRef: RefObject<HTMLElement | null>,
  propertyName: `--${string}`,
  fallback: number,
): number {
  const [value, setValue] = useState(fallback);
  const readValue = useCallback(() => {
    const element = elementRef.current;
    if (!element) return;
    const nextValue = resolveCssPixelCustomProperty(element, propertyName, fallback);
    setValue((currentValue) => currentValue === nextValue ? currentValue : nextValue);
  }, [elementRef, fallback, propertyName]);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return undefined;
    readValue();

    const ownerDocument = element.ownerDocument;
    const appearanceRoot = element.closest<HTMLElement>("[data-po-appearance-root]")
      ?? ownerDocument.documentElement;
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(readValue);
    // Appearance profiles are extensible and may introduce new data attributes
    // that affect geometry. Watching the root's complete (low-frequency)
    // attribute surface avoids coupling numeric layout consumers to today's
    // list of theme selectors.
    mutationObserver?.observe(appearanceRoot, { attributes: true });

    const unsubscribeTypography = subscribeTypographyChanges(ownerDocument, readValue);

    return () => {
      mutationObserver?.disconnect();
      unsubscribeTypography();
    };
  }, [elementRef, readValue]);

  return value;
}
