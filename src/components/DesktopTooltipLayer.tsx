import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Placement = "bottom" | "top" | "right" | "left";
type ActiveTooltip = {
  target: HTMLElement;
  label: string;
  shortcut: string | null;
  placement: Placement;
};

const HOVER_DELAY_MS = 450;
const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 8;

function readTooltip(target: HTMLElement): ActiveTooltip | null {
  const label = target.dataset.tooltip?.trim();
  if (!label) return null;
  const placement = target.dataset.tooltipPlacement;
  return {
    target,
    label,
    shortcut: target.dataset.tooltipShortcut?.trim() || null,
    placement: placement === "top" || placement === "right" || placement === "left"
      ? placement
      : "bottom",
  };
}

function tooltipTarget(node: EventTarget | null): HTMLElement | null {
  return node instanceof Element
    ? node.closest<HTMLElement>("[data-tooltip]")
    : null;
}

function positionTooltip(
  trigger: DOMRect,
  tooltip: DOMRect,
  preferred: Placement,
): { left: number; top: number } {
  const opposite: Record<Placement, Placement> = {
    bottom: "top",
    top: "bottom",
    right: "left",
    left: "right",
  };
  const fits = (placement: Placement) => {
    if (placement === "bottom") return trigger.bottom + TRIGGER_GAP + tooltip.height <= window.innerHeight - VIEWPORT_MARGIN;
    if (placement === "top") return trigger.top - TRIGGER_GAP - tooltip.height >= VIEWPORT_MARGIN;
    if (placement === "right") return trigger.right + TRIGGER_GAP + tooltip.width <= window.innerWidth - VIEWPORT_MARGIN;
    return trigger.left - TRIGGER_GAP - tooltip.width >= VIEWPORT_MARGIN;
  };
  const placement = fits(preferred) ? preferred : fits(opposite[preferred]) ? opposite[preferred] : preferred;
  const left = placement === "right"
    ? trigger.right + TRIGGER_GAP
    : placement === "left"
      ? trigger.left - tooltip.width - TRIGGER_GAP
      : trigger.left + (trigger.width - tooltip.width) / 2;
  const top = placement === "bottom"
    ? trigger.bottom + TRIGGER_GAP
    : placement === "top"
      ? trigger.top - tooltip.height - TRIGGER_GAP
      : trigger.top + (trigger.height - tooltip.height) / 2;
  return {
    left: Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - tooltip.width - VIEWPORT_MARGIN)),
    top: Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - tooltip.height - VIEWPORT_MARGIN)),
  };
}

/** One tooltip surface for every explicitly marked desktop control or content hint. */
export function DesktopTooltipLayer() {
  const tooltipId = useId();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const activeTarget = useRef<HTMLElement | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    let pointerFocusTarget: HTMLElement | null = null;
    const cancelTimer = () => {
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    };
    const hide = () => {
      cancelTimer();
      activeTarget.current = null;
      setActive(null);
      setPosition(null);
    };
    const show = (target: HTMLElement, delayed: boolean) => {
      if (activeTarget.current === target && delayed) return;
      cancelTimer();
      activeTarget.current = target;
      setActive(null);
      setPosition(null);
      if (delayed) {
        hoverTimer.current = window.setTimeout(() => {
          if (activeTarget.current === target && target.isConnected) setActive(readTooltip(target));
        }, HOVER_DELAY_MS);
      } else {
        setActive(readTooltip(target));
      }
    };
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const target = tooltipTarget(event.target);
      if (target && !target.contains(event.relatedTarget as Node | null)) show(target, true);
    };
    const onPointerOut = (event: PointerEvent) => {
      const target = activeTarget.current;
      if (!target || !target.contains(event.target as Node)) return;
      if (target.contains(event.relatedTarget as Node | null)) return;
      if (target.contains(document.activeElement)) return;
      hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = tooltipTarget(event.target);
      if (target && target !== pointerFocusTarget) show(target, false);
      pointerFocusTarget = null;
    };
    const onFocusOut = (event: FocusEvent) => {
      const target = activeTarget.current;
      if (target && target.contains(event.target as Node) && !target.matches(":hover")) hide();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      pointerFocusTarget = null;
      if (event.key === "Escape") hide();
    };
    const onPointerDown = (event: PointerEvent) => {
      pointerFocusTarget = tooltipTarget(event.target);
      hide();
    };
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    window.addEventListener("blur", hide);
    return () => {
      cancelTimer();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!active || !tooltipRef.current || !active.target.isConnected) return;
    setPosition(positionTooltip(
      active.target.getBoundingClientRect(),
      tooltipRef.current.getBoundingClientRect(),
      active.placement,
    ));
    const previousDescription = active.target.getAttribute("aria-describedby");
    active.target.setAttribute("aria-describedby", [previousDescription, tooltipId].filter(Boolean).join(" "));
    return () => {
      if (!active.target.isConnected) return;
      if (previousDescription) active.target.setAttribute("aria-describedby", previousDescription);
      else active.target.removeAttribute("aria-describedby");
    };
  }, [active, tooltipId]);

  if (!active) return null;
  // The overlay root carries the selected UI font and small/medium/large scale.
  const portalHost = document.getElementById("desktop-overlay-root") ?? document.body;
  return createPortal(
    <div
      ref={tooltipRef}
      id={tooltipId}
      className="desktop-tooltip"
      role="tooltip"
      style={position ?? { visibility: "hidden" }}
    >
      <span className="desktop-tooltip-label" dir="auto">{active.label}</span>
      {active.shortcut && <kbd className="desktop-tooltip-shortcut">{active.shortcut}</kbd>}
    </div>,
    portalHost,
  );
}
