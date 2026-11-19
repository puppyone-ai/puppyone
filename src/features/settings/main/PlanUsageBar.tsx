import { meterTone } from "./planPricing";

/** A complete short rail stays visible for every reading, including zero. */
export function PlanUsageBar({ percent, kind, label, reading }: {
  percent: number | null;
  kind: "hours" | "storage";
  label?: string;
  reading?: string;
}) {
  const bounded = percent === null ? null : Math.max(0, Math.min(100, percent));
  const bars = 24;
  const activeBars = bounded === null || bounded === 0 ? 0 : Math.max(1, Math.round((bounded / 100) * bars));
  return (
    <div
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
