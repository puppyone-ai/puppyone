import { meterTone } from "./planPricing";

/** One square of three uninterrupted bars; the adjacent reading carries the exact value. */
export function PlanUsageBar({ percent, kind, label, reading }: {
  percent: number | null;
  kind: "hours" | "storage";
  label?: string;
  reading?: string;
}) {
  const bounded = percent === null ? null : Math.max(0, Math.min(100, percent));
  const activeBars = Math.ceil(((bounded ?? 0) / 100) * 3);
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
      {Array.from({ length: 3 }, (_, bar) => (
        <span className="desktop-plan-meter-tick" key={bar} data-active={bar < activeBars || undefined} />
      ))}
    </div>
  );
}
