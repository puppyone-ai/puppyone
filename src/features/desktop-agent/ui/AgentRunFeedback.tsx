import { Dots } from "../../../components/loading";

/** Live and completed feedback share text geometry; the loader never indents the label. */
export function AgentRunFeedback({ label, ariaLabel, busy = false, className = "", status }: {
  label: string;
  ariaLabel?: string;
  busy?: boolean;
  className?: string;
  status?: string;
}) {
  return (
    <span className={`desktop-agent-run-feedback ${className}`.trim()} role="status"
      aria-label={ariaLabel} data-status={status}>
      <span className="desktop-agent-run-feedback-label">{label}</span>
      {busy && <Dots size="xs" tone="neutral" ariaHidden />}
    </span>
  );
}
