import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization/react";

const ACTIVE_SCROLLBAR_CLASS = "po-scrollbar-active";
const MANAGED_SCROLLBAR_SELECTOR = '[data-po-scrollbar]:not([data-po-scrollbar="hidden"])';
const HISTORICAL_SCROLLBAR_COMPOSITION = "windows-xp-classic-v1";
const SCROLL_IDLE_DELAY_MS = 900;
const SCROLLBAR_REPEAT_DELAY_MS = 320;
const SCROLLBAR_REPEAT_INTERVAL_MS = 54;
const DEFAULT_ARROW_SCROLL_STEP = 28;
const HISTORICAL_SCROLLBAR_PRESENTATION_TOKENS = [
  "--interface-scrollbar-button-border",
  "--interface-scrollbar-button-background-color",
  "--interface-scrollbar-button-background-image",
  "--interface-scrollbar-button-background-image-horizontal",
  "--interface-scrollbar-button-box-shadow",
  "--interface-scrollbar-button-hover-border-color",
  "--interface-scrollbar-button-hover-background-color",
  "--interface-scrollbar-button-up-image",
  "--interface-scrollbar-button-down-image",
  "--interface-scrollbar-button-left-image",
  "--interface-scrollbar-button-right-image",
] as const;

type HistoricalScrollbarOrientation = "horizontal" | "vertical";

type HistoricalScrollbarPresentation = Record<
  (typeof HISTORICAL_SCROLLBAR_PRESENTATION_TOKENS)[number],
  string
>;

type HistoricalScrollbarControl = {
  id: number;
  owner: HTMLElement;
  host: HTMLElement;
  orientation: HistoricalScrollbarOrientation;
  top: number;
  left: number;
  height: number;
  width: number;
  size: number;
  canDecrement: boolean;
  canIncrement: boolean;
  presentation: HistoricalScrollbarPresentation;
};

let nextHistoricalScrollbarId = 1;
const historicalScrollbarIds = new WeakMap<HTMLElement, number>();

function getHistoricalScrollbarId(owner: HTMLElement) {
  const existing = historicalScrollbarIds.get(owner);
  if (existing) return existing;
  const id = nextHistoricalScrollbarId;
  nextHistoricalScrollbarId += 1;
  historicalScrollbarIds.set(owner, id);
  return id;
}

function historicalScrollbarSignature(controls: HistoricalScrollbarControl[]) {
  return controls.map((control) => [
    control.id,
    control.orientation,
    control.top,
    control.left,
    control.height,
    control.width,
    control.size,
    control.canDecrement,
    control.canIncrement,
    ...HISTORICAL_SCROLLBAR_PRESENTATION_TOKENS.map((token) => control.presentation[token]),
  ].join(":")).join("|");
}

function resolveHistoricalScrollbarPresentation(
  ownerStyle: CSSStyleDeclaration,
): HistoricalScrollbarPresentation {
  return Object.fromEntries(HISTORICAL_SCROLLBAR_PRESENTATION_TOKENS.map((token) => [
    token,
    ownerStyle.getPropertyValue(token).trim(),
  ])) as HistoricalScrollbarPresentation;
}

function resolveHistoricalScrollbarControls(): HistoricalScrollbarControl[] {
  const root = document.documentElement;
  if (
    root.dataset.scrollbarComposition !== HISTORICAL_SCROLLBAR_COMPOSITION
    || root.dataset.poScrollbarMode !== "product"
  ) {
    return [];
  }

  return Array.from(document.querySelectorAll<HTMLElement>(MANAGED_SCROLLBAR_SELECTOR))
    .filter((owner) => owner.dataset.poScrollbar !== "menu")
    .flatMap((owner) => {
      const host = owner.parentElement;
      if (!host) return [];

      const rect = owner.getBoundingClientRect();
      const ownerStyle = getComputedStyle(owner);
      const hostRect = host.getBoundingClientRect();
      const hostStyle = getComputedStyle(host);
      const scrollbarSize = Number.parseFloat(
        ownerStyle.getPropertyValue("--po-scrollbar-size"),
      ) || 12;
      const hasVerticalOverflow = owner.scrollHeight > owner.clientHeight + 1;
      const hasHorizontalOverflow = owner.scrollWidth > owner.clientWidth + 1;
      const managesVertical = owner.dataset.poScrollbar !== "horizontal" && hasVerticalOverflow;
      const managesHorizontal = hasHorizontalOverflow;
      const isVisible = ownerStyle.display !== "none"
        && ownerStyle.visibility !== "hidden"
        && rect.width >= scrollbarSize
        && rect.height >= scrollbarSize
        && rect.right > 0
        && rect.bottom > 0
        && rect.left < window.innerWidth
        && rect.top < window.innerHeight;
      if ((!managesVertical && !managesHorizontal) || !isVisible) return [];

      const hostBorderBlockStart = Number.parseFloat(hostStyle.borderTopWidth) || 0;
      const hostBorderInlineStart = Number.parseFloat(hostStyle.borderLeftWidth) || 0;
      const isRtl = ownerStyle.direction === "rtl";
      const ownerInlineStart = isRtl ? rect.left : rect.right - scrollbarSize;
      const ownerTop = rect.top - hostRect.top - hostBorderBlockStart + host.scrollTop;
      const ownerLeft = rect.left - hostRect.left - hostBorderInlineStart + host.scrollLeft;
      const horizontalPosition = isRtl ? Math.abs(owner.scrollLeft) : owner.scrollLeft;
      const controls: HistoricalScrollbarControl[] = [];
      const id = getHistoricalScrollbarId(owner);
      const presentation = resolveHistoricalScrollbarPresentation(ownerStyle);

      if (managesVertical && rect.height >= scrollbarSize * 2) {
        controls.push({
          id,
          owner,
          host,
          orientation: "vertical",
          top: Math.round(ownerTop),
          left: Math.round(
            ownerInlineStart - hostRect.left - hostBorderInlineStart + host.scrollLeft,
          ),
          height: Math.round(rect.height - (hasHorizontalOverflow ? scrollbarSize : 0)),
          width: scrollbarSize,
          size: scrollbarSize,
          canDecrement: owner.scrollTop > 0.5,
          canIncrement: owner.scrollTop + owner.clientHeight < owner.scrollHeight - 0.5,
          presentation,
        });
      }

      if (managesHorizontal && rect.width >= scrollbarSize * 2) {
        controls.push({
          id,
          owner,
          host,
          orientation: "horizontal",
          top: Math.round(ownerTop + rect.height - scrollbarSize),
          left: Math.round(ownerLeft + (isRtl && hasVerticalOverflow ? scrollbarSize : 0)),
          height: scrollbarSize,
          width: Math.round(rect.width - (hasVerticalOverflow ? scrollbarSize : 0)),
          size: scrollbarSize,
          canDecrement: horizontalPosition > 0.5,
          canIncrement: horizontalPosition + owner.clientWidth < owner.scrollWidth - 0.5,
          presentation,
        });
      }

      return controls;
    });
}

function getScrollTarget(target: EventTarget | null): Element | null {
  if (
    target === window
    || target === document
    || target === document.documentElement
    || target === document.body
  ) {
    return document.documentElement.matches(MANAGED_SCROLLBAR_SELECTOR)
      ? document.documentElement
      : null;
  }

  if (!(target instanceof Element)) return null;
  return target.matches(MANAGED_SCROLLBAR_SELECTOR) ? target : null;
}

/**
 * Adds transient interaction state to registered scrollbar owners and mounts
 * historical arrow buttons inside each owner's local pane. The controls are
 * never viewport-positioned and therefore remain below overlay/menu layers.
 */
export function ScrollbarActivity() {
  const { t } = useLocalization();
  const [historicalControls, setHistoricalControls] = useState<HistoricalScrollbarControl[]>([]);
  const historicalControlsRef = useRef<HistoricalScrollbarControl[]>([]);
  const repeatDelayRef = useRef<number | null>(null);
  const repeatIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    const timers = new Map<Element, number>();

    const markActive = (event: Event) => {
      const target = getScrollTarget(event.target);
      if (!target) return;
      target.classList.add(ACTIVE_SCROLLBAR_CLASS);

      const existingTimer = timers.get(target);
      if (existingTimer) window.clearTimeout(existingTimer);

      const nextTimer = window.setTimeout(() => {
        target.classList.remove(ACTIVE_SCROLLBAR_CLASS);
        timers.delete(target);
      }, SCROLL_IDLE_DELAY_MS);

      timers.set(target, nextTimer);
    };

    window.addEventListener("scroll", markActive, { capture: true, passive: true });

    return () => {
      window.removeEventListener("scroll", markActive, { capture: true });
      timers.forEach((timer, target) => {
        window.clearTimeout(timer);
        target.classList.remove(ACTIVE_SCROLLBAR_CLASS);
      });
      timers.clear();
    };
  }, []);

  useEffect(() => {
    let animationFrame = 0;
    const resizeObserver = new ResizeObserver(() => scheduleRefresh());
    const observedOwners = new Set<HTMLElement>();
    const markedHosts = new Set<HTMLElement>();

    const refresh = () => {
      animationFrame = 0;
      const controls = resolveHistoricalScrollbarControls();
      const nextOwners = new Set(controls.map(({ owner }) => owner));
      const nextHosts = new Set(controls.map(({ host }) => host));

      for (const owner of observedOwners) {
        if (nextOwners.has(owner)) continue;
        resizeObserver.unobserve(owner);
        observedOwners.delete(owner);
      }
      for (const owner of nextOwners) {
        if (observedOwners.has(owner)) continue;
        resizeObserver.observe(owner);
        observedOwners.add(owner);
      }
      for (const host of markedHosts) {
        if (nextHosts.has(host)) continue;
        host.removeAttribute("data-po-scrollbar-control-host");
        host.removeAttribute("data-po-scrollbar-control-host-positioned");
        markedHosts.delete(host);
      }
      for (const host of nextHosts) {
        if (markedHosts.has(host)) continue;
        if (getComputedStyle(host).position === "static") {
          host.setAttribute("data-po-scrollbar-control-host-positioned", "true");
        }
        host.setAttribute("data-po-scrollbar-control-host", "true");
        markedHosts.add(host);
      }

      if (
        historicalScrollbarSignature(controls)
        !== historicalScrollbarSignature(historicalControlsRef.current)
      ) {
        historicalControlsRef.current = controls;
        setHistoricalControls(controls);
      }
    };

    function scheduleRefresh() {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(refresh);
    }

    const mutationObserver = new MutationObserver(scheduleRefresh);
    mutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-scrollbar-composition", "data-po-scrollbar-mode"],
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", scheduleRefresh, { passive: true });
    window.addEventListener("scroll", scheduleRefresh, { capture: true, passive: true });
    scheduleRefresh();

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      observedOwners.clear();
      markedHosts.forEach((host) => {
        host.removeAttribute("data-po-scrollbar-control-host");
        host.removeAttribute("data-po-scrollbar-control-host-positioned");
      });
      markedHosts.clear();
      window.removeEventListener("resize", scheduleRefresh);
      window.removeEventListener("scroll", scheduleRefresh, { capture: true });
    };
  }, []);

  const stopRepeating = () => {
    if (repeatDelayRef.current !== null) window.clearTimeout(repeatDelayRef.current);
    if (repeatIntervalRef.current !== null) window.clearInterval(repeatIntervalRef.current);
    repeatDelayRef.current = null;
    repeatIntervalRef.current = null;
  };

  useEffect(() => stopRepeating, []);

  const beginScrolling = (
    event: ReactPointerEvent<HTMLButtonElement>,
    owner: HTMLElement,
    orientation: HistoricalScrollbarOrientation,
    direction: -1 | 1,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    stopRepeating();
    const viewportSize = orientation === "vertical" ? owner.clientHeight : owner.clientWidth;
    const step = Math.max(DEFAULT_ARROW_SCROLL_STEP, Math.round(viewportSize * 0.04));
    const scroll = () => owner.scrollBy({
      behavior: "auto",
      left: orientation === "horizontal" ? direction * step : 0,
      top: orientation === "vertical" ? direction * step : 0,
    });
    scroll();
    repeatDelayRef.current = window.setTimeout(() => {
      repeatIntervalRef.current = window.setInterval(scroll, SCROLLBAR_REPEAT_INTERVAL_MS);
    }, SCROLLBAR_REPEAT_DELAY_MS);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  return historicalControls.map((control) => createPortal(
    <div
      className="po-classic-scrollbar-controls"
      data-visible="true"
      data-scrollbar-owner-id={control.id}
      data-scrollbar-orientation={control.orientation}
      aria-hidden="true"
      style={{
        ...control.presentation,
        "--po-classic-scrollbar-size": `${control.size}px`,
        top: `${control.top}px`,
        left: `${control.left}px`,
        height: `${control.height}px`,
        width: `${control.width}px`,
      } as CSSProperties}
    >
      <Tooltip content={t(control.orientation === "vertical" ? "shared-ui.scrollbar.up" : "shared-ui.scrollbar.left")}><button
        className="po-classic-scrollbar-button decrement"
        aria-label={t(control.orientation === "vertical" ? "shared-ui.scrollbar.up" : "shared-ui.scrollbar.left")}
        type="button"
        tabIndex={-1}
        disabled={!control.canDecrement}
        onPointerDown={(event) => beginScrolling(
          event,
          control.owner,
          control.orientation,
          -1,
        )}
        onPointerUp={stopRepeating}
        onPointerCancel={stopRepeating}
        onLostPointerCapture={stopRepeating}
      /></Tooltip>
      <Tooltip content={t(control.orientation === "vertical" ? "shared-ui.scrollbar.down" : "shared-ui.scrollbar.right")}><button
        className="po-classic-scrollbar-button increment"
        aria-label={t(control.orientation === "vertical" ? "shared-ui.scrollbar.down" : "shared-ui.scrollbar.right")}
        type="button"
        tabIndex={-1}
        disabled={!control.canIncrement}
        onPointerDown={(event) => beginScrolling(
          event,
          control.owner,
          control.orientation,
          1,
        )}
        onPointerUp={stopRepeating}
        onPointerCancel={stopRepeating}
        onLostPointerCapture={stopRepeating}
      /></Tooltip>
    </div>,
    control.host,
    `${control.id}:${control.orientation}`,
  ));
}
