import type { ReactNode } from "react";

export function SettingsSectionHeader({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="desktop-settings-section-header">
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
    </div>
  );
}

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="desktop-settings-group">
      <div className="desktop-settings-group-title">{title}</div>
      <div className="desktop-settings-group-body">{children}</div>
    </section>
  );
}

export function SettingsLine({
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
    <div className="desktop-settings-line">
      <span>{label}</span>
      <div className="desktop-settings-line-value">
        <strong
          className={`${monospace ? "desktop-settings-code" : ""} ${tone === "success" ? "success" : ""}`}
          title={title}
        >
          {value}
        </strong>
        {action}
      </div>
    </div>
  );
}
