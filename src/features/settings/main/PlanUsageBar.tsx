import type { CSSProperties } from "react";
import { meterTone } from "./planPricing";

const CELL_COUNT = 12;
const BARS_PER_CELL = 3;

/** Twelve square cells, each split into three bars, with an exact fractional fill. */
export function PlanUsageBar({ percent, kind, label, reading }: {
  percent: number | null;
  kind: "hours" | "storage";
  label?: string;
  reading?: string;
}) {
  const bounded = percent === null ? null : Math.max(0, Math.min(100, percent));
  const filledBars = ((bounded ?? 0) / 100) * CELL_COUNT * BARS_PER_CELL;
  return (
    <div
      className={`desktop-plan-meter is-${kind}${bounded === null ? " is-unknown" : meterTone(bounded)}`}
      style={{ "--desktop-plan-meter-cells": CELL_COUNT } as CSSProperties}
      role={bounded === null ? undefined : "progressbar"}
      aria-hidden={bounded === null ? true : undefined}
      aria-label={bounded === null ? undefined : label}
      aria-valuemin={bounded === null ? undefined : 0}
      aria-valuemax={bounded === null ? undefined : 100}
      aria-valuenow={bounded === null ? undefined : Math.round(bounded)}
      aria-valuetext={bounded === null ? undefined : reading}
    >
      {Array.from({ length: CELL_COUNT }, (_, cell) => (
        <span className="desktop-plan-meter-cell" key={cell}>
          {Array.from({ length: BARS_PER_CELL }, (_, bar) => (
            <span className="desktop-plan-meter-tick" key={bar} style={{
              "--desktop-plan-tick-fill": `${Math.max(0, Math.min(1, filledBars - cell * BARS_PER_CELL - bar)) * 100}%`,
            } as CSSProperties} />
          ))}
        </span>
      ))}
    </div>
  );
}
