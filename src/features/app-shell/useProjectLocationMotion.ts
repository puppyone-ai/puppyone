import { useLayoutEffect, useRef, useState } from "react";

/** Follow the real button geometry, including translated and device labels. */
export function useProjectLocationMotion(current: "local" | "cloud", labelKey: string) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ x: 0, width: 0 });
  const [canAnimate, setCanAnimate] = useState(false);
  useLayoutEffect(() => {
    // Opening mounts a fresh plate. Settle its measured position before
    // enabling transitions, so reopening Cloud never slides from Local.
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setCanAnimate(true));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, []);
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const selected = track.querySelector<HTMLButtonElement>(`button[data-project-location="${current}"]`);
      if (!selected) return;
      const x = selected.offsetLeft;
      const width = selected.offsetWidth;
      setGeometry(previous => previous.x === x && previous.width === width ? previous : { x, width });
    };
    measure();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(track);
    track.querySelectorAll("button").forEach(button => observer?.observe(button));
    return () => observer?.disconnect();
  }, [current, labelKey]);
  return { trackRef, indicatorStyle: { width: geometry.width, transform: `translateX(${geometry.x}px)`,
    transition: canAnimate ? undefined : "none" },
    measured: geometry.width > 0 };
}
