import { Tooltip } from "@puppyone/shared-ui";
import { useId, type ReactNode } from "react";

export function SettingsSectionHeader({ title }: { title: string }) {
  return (
    <div className="desktop-settings-section-header">
      <h2>{title}</h2>
    </div>
  );
}

export function SettingsSubsection({ title, detail, children, leading = false }: { title?: string; detail?: string; children: ReactNode; leading?: boolean }) {
  const titleId = useId();
  const content = (
    <>
      {title && <h3 className="desktop-settings-subsection-title" id={titleId}>{title}</h3>}
      {detail && <p className="desktop-settings-subsection-detail">{detail}</p>}
      <div className="desktop-settings-subsection-body">{children}</div>
    </>
  );

  return title ? (
    <section className={`desktop-settings-subsection${leading ? " desktop-settings-lead-group" : ""}`} aria-labelledby={titleId}>{content}</section>
  ) : (
    <div className={`desktop-settings-subsection${leading ? " desktop-settings-lead-rows" : ""}`}>{content}</div>
  );
}

export function SettingsValueRow({
  label,
  value,
  tooltip,
  tooltipOverflowOnly = false,
  action,
  monospace = false,
  tone,
}: {
  label: string;
  value: ReactNode;
  tooltip?: string;
  tooltipOverflowOnly?: boolean;
  action?: ReactNode;
  monospace?: boolean;
  tone?: "success";
}) {
  return (
    <div className={`desktop-settings-row desktop-settings-value-row ${action ? "desktop-settings-row-control" : ""}`}>
      <span>{label}</span>
      <div className="desktop-settings-value">
        <Tooltip content={tooltip} overflowOnly={tooltipOverflowOnly}><span
          className={`desktop-settings-value-text ${monospace ? "desktop-settings-code" : ""} ${tone === "success" ? "success" : ""}`}
          dir={monospace ? "ltr" : "auto"}
        >
          {value}
        </span></Tooltip>
        {action}
      </div>
    </div>
  );
}

export function SettingsToggle({
  checked,
  description,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  description?: string;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="desktop-settings-switch">
      <input
        type="checkbox"
        aria-label={label}
        aria-description={description}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden="true" />
    </label>
  );
}
