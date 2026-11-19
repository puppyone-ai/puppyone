import type { ReactNode } from "react";

type DesktopEntryStateProps = {
  ariaLabel: string;
  visual: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action: ReactNode;
  feedback?: ReactNode;
  className?: string;
};

/**
 * Shared full-surface layout for first-run and unavailable-feature entry states.
 *
 * Keeping the centering coordinate system here prevents individual features
 * from drifting when their surrounding page shells use different padding or
 * layout modes. Feature components own only their icon and behavior.
 */
export function DesktopEntryState({
  ariaLabel,
  visual,
  title,
  description,
  action,
  feedback,
  className,
}: DesktopEntryStateProps) {
  const rootClassName = className
    ? `desktop-entry-state ${className}`
    : "desktop-entry-state";

  return (
    <section className={rootClassName} aria-label={ariaLabel}>
      <div className="desktop-entry-state-body">
        <div className="desktop-entry-state-shell">
          <div className="desktop-entry-state-visual" aria-hidden="true">
            {visual}
          </div>
          <div className="desktop-entry-state-content">
            <header className="desktop-entry-state-copy">
              <h1>{title}</h1>
            </header>
            {description && <p className="desktop-entry-state-description">{description}</p>}
            <div className="desktop-entry-state-action">{action}</div>
            {feedback}
          </div>
        </div>
      </div>
    </section>
  );
}
