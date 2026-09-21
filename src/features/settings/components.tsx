import { useId, type ReactNode } from "react";

export function SettingsSectionHeader({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="desktop-settings-section-header">
      <h2>{title}</h2>
      {detail && <span>{detail}</span>}
    </div>
  );
}

export function SettingsSubsection({ title, detail, children }: { title?: string; detail?: string; children: ReactNode }) {
  const titleId = useId();
  const content = (
    <>
      {title && <h3 className="desktop-settings-subsection-title" id={titleId}>{title}</h3>}
      {detail && <p className="desktop-settings-subsection-detail">{detail}</p>}
      <div className="desktop-settings-subsection-body">{children}</div>
    </>
  );

  return title ? (
    <section className="desktop-settings-subsection" aria-labelledby={titleId}>{content}</section>
  ) : (
    <div className="desktop-settings-subsection">{content}</div>
  );
}

export function SettingsValueRow({
  label,
  value,
  title,
  action,
  monospace = false,
  tone,
}: {
  label: string;
  value: ReactNode;
  title?: string;
  action?: ReactNode;
  monospace?: boolean;
  tone?: "success";
}) {
  return (
    <div className={`desktop-settings-row desktop-settings-value-row ${action ? "desktop-settings-row-control" : ""}`}>
      <span>{label}</span>
      <div className="desktop-settings-value">
        <span
          className={`desktop-settings-value-text ${monospace ? "desktop-settings-code" : ""} ${tone === "success" ? "success" : ""}`}
          dir={monospace ? "ltr" : "auto"}
          title={title}
        >
          {value}
        </span>
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
    <label className="desktop-settings-switch" title={description}>
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
