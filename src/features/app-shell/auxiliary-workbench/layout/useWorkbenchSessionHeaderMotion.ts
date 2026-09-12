import { useLayoutEffect, useRef, type RefObject } from "react";
import { WORKBENCH_SESSION_HEADER_METRICS, type WorkbenchSessionHeaderLayout } from "./workbenchSessionHeaderLayout";

type Bounds = { x: number; width: number };
type Entry = { bounds: Bounds; animation?: Animation };

/** One layout transaction retargets every visible element from its current pixels. */
export function useWorkbenchSessionHeaderMotion(
  capacityRef: RefObject<HTMLDivElement | null>,
  layout: WorkbenchSessionHeaderLayout,
  enabled: boolean,
) {
  const previous = useRef(new Map<HTMLElement, Entry>());
  const lastLayout = useRef<{ layout: WorkbenchSessionHeaderLayout; enabled: boolean; rtl: boolean } | null>(null);

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cancel = () => { for (const entry of previous.current.values()) entry.animation?.cancel(); };
    const onChange = () => { if (media.matches) cancel(); };
    media.addEventListener("change", onChange);
    return () => { media.removeEventListener("change", onChange); cancel(); previous.current.clear(); lastLayout.current = null; };
  }, []);

  useLayoutEffect(() => {
    const rail = capacityRef.current?.querySelector<HTMLElement>(".desktop-terminal-tab-rail");
    if (!rail) return;
    const rtl = getComputedStyle(rail).direction === "rtl";
    const last = lastLayout.current;
    if (last && last.enabled === enabled && last.rtl === rtl && sameGeometry(last.layout, layout)) return;
    lastLayout.current = { layout, enabled, rtl };
    const origin = rail.getBoundingClientRect();
    const measure = (element: HTMLElement): Bounds => {
      const rect = element.getBoundingClientRect();
      return { x: rtl ? origin.right - rect.right : rect.left - origin.left, width: rect.width };
    };
    const elements = [...rail.querySelectorAll<HTMLElement>(".desktop-terminal-tabs, .desktop-terminal-tab, .desktop-terminal-tab-overflow-wrap, .desktop-terminal-new-button")];
    const starts = new Map<HTMLElement, Bounds>();
    // Read all interrupted positions before cancelling any animation or measuring targets.
    for (const element of elements) {
      const entry = previous.current.get(element);
      if (entry) starts.set(element, entry.animation && entry.animation.playState !== "finished" && entry.animation.playState !== "idle"
        ? measure(element) : entry.bounds);
    }
    for (const entry of previous.current.values()) entry.animation?.cancel();
    const targets = new Map(elements.map((element) => [element, measure(element)]));
    const animate = enabled && !window.matchMedia("(prefers-reduced-motion: reduce)").matches && previous.current.size > 0;
    const next = new Map<HTMLElement, Entry>();
    const tabs = elements.filter((element) => element.classList.contains("desktop-terminal-tab"));
    tabs.forEach((element, index) => {
      if (starts.has(element)) return;
      const before = tabs[index - 1];
      const after = tabs.slice(index + 1).find((tab) => starts.has(tab));
      const anchor = before ? starts.get(before) : after ? starts.get(after) : null;
      starts.set(element, { x: anchor
        ? anchor.x + (before ? anchor.width + WORKBENCH_SESSION_HEADER_METRICS.gap : 0)
        : targets.get(element)!.x, width: 0 });
    });
    const overflow = rail.querySelector<HTMLElement>(".desktop-terminal-tab-overflow-wrap");
    const plus = rail.querySelector<HTMLElement>(".desktop-terminal-new-button");
    if (overflow && plus && !starts.has(overflow)) {
      starts.set(overflow, { x: starts.get(plus)?.x ?? targets.get(overflow)!.x, width: 0 });
    }
    const startTime = document.timeline?.currentTime;
    for (const element of elements) {
      const bounds = targets.get(element)!;
      const start = starts.get(element) ?? { ...bounds, width: 0 };
      const entry: Entry = { bounds };
      if (animate && typeof element.animate === "function" && (start.x !== bounds.x || start.width !== bounds.width)) {
        const position = rtl ? "right" : "left";
        const keyframe = (value: Bounds) => ({ [position]: `${value.x}px`, width: `${value.width}px` });
        entry.animation = element.animate([keyframe(start), keyframe(bounds)], {
          duration: WORKBENCH_SESSION_HEADER_METRICS.layoutMotionMs, easing: "cubic-bezier(0.2, 0, 0, 1)",
        });
        entry.animation.id = "workbench-header-layout";
        if (typeof startTime === "number") entry.animation.startTime = startTime;
      }
      next.set(element, entry);
    }
    previous.current = next;
  }, [capacityRef, enabled, layout]);
}

function sameGeometry(left: WorkbenchSessionHeaderLayout, right: WorkbenchSessionHeaderLayout) {
  return left.tabsWidth === right.tabsWidth && Boolean(left.hiddenSessionIds.length) === Boolean(right.hiddenSessionIds.length)
    && left.tabBounds.length === right.tabBounds.length && left.tabBounds.every((bounds, index) => {
      const next = right.tabBounds[index];
      return bounds.sessionId === next.sessionId && bounds.width === next.width && bounds.inlineStart === next.inlineStart;
    });
}
