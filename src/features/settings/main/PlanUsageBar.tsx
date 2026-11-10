import { useLayoutEffect, useRef, useState } from "react";
import { meterTone } from "./planPricing";

/** Repeat the reference's square of three full-height bars across the whole rail. */
export function PlanUsageBar({ percent, kind, label, reading }: {
  percent: number | null;
  kind: "hours" | "storage";
  label?: string;
  reading?: string;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [groups, setGroups] = useState(1);
  useLayoutEffect(() => {
    const element = rail.current;
    if (!element) return;
    const measure = () => {
      // Each square is 18px wide, with at least 6px between squares.
      setGroups(Math.max(1, Math.floor((element.getBoundingClientRect().width + 6) / 24)));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const bounded = percent === null ? null : Math.max(0, Math.min(100, percent));
  const activeBars = Math.round(((bounded ?? 0) / 100) * groups * 3);
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
      {Array.from({ length: groups }, (_, group) => (
        <span className="desktop-plan-meter-group" key={group} aria-hidden="true">
          {Array.from({ length: 3 }, (_, bar) => (
            <span className="desktop-plan-meter-tick" key={bar} data-active={group * 3 + bar < activeBars || undefined} />
          ))}
        </span>
      ))}
    </div>
  );
}
