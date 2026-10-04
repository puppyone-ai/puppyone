import { useLayoutEffect, useRef, useState } from "react";

/** Follow the real button geometry, including translated and device labels. */
export function useProjectLocationMotion(current: "local" | "cloud", labelKey: string) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ x: 0, width: 0 });
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
  return { trackRef, indicatorStyle: { width: geometry.width, transform: `translateX(${geometry.x}px)` },
    measured: geometry.width > 0 };
}
