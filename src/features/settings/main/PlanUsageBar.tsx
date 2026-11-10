import { useLayoutEffect, useRef, useState } from "react";
import { meterTone } from "./planPricing";

/** A single row of thin, evenly spaced bars, with no grouped gaps. */
export function PlanUsageBar({ percent, kind, label, reading }: {
  percent: number | null;
  kind: "hours" | "storage";
  label?: string;
  reading?: string;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [bars, setBars] = useState(1);
  useLayoutEffect(() => {
    const element = rail.current;
    if (!element) return;
    const measure = () => {
      // Keep 2px bars at least 10px apart and avoid crowding wider rails.
      setBars(Math.max(1, Math.min(48, Math.floor((element.getBoundingClientRect().width + 10) / 12))));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const bounded = percent === null ? null : Math.max(0, Math.min(100, percent));
  const activeBars = Math.round(((bounded ?? 0) / 100) * bars);
  return (
    <div
      ref={rail}
      className={`desktop-plan-meter is-${kind}${bounded === null ? " is-unknown" : meterTone(bounded)}`}
      role={bounded === null ? undefined : "progressbar"}
      aria-hidden={bounded === null ? true : undefined}
      aria-label={bounded === null ? undefined : label}
      aria-valuemin={bounded === null ? undefined : 0}
      aria-valuemax={bounded === null ? undefined : 100}
      aria-valuenow={bounded === null ? undefined : Math.round(bounded)}
      aria-valuetext={bounded === null ? undefined : reading}
    >
      {Array.from({ length: bars }, (_, bar) => (
        <span className="desktop-plan-meter-tick" key={bar} aria-hidden="true" data-active={bar < activeBars || undefined} />
      ))}
    </div>
  );
}
