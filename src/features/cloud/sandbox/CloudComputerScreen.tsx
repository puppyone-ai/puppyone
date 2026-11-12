import { Monitor } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import "./cloud-computer-screen.css";

/** A small screen under the explorer; opening it shows the screen in the editor area. */
export function CloudScreenThumbnail({ preview, active, onOpen }: {
  preview: boolean;
  active: boolean;
  onOpen: () => void;
}) {
  const { t } = useLocalization();
  const label = preview
    ? `${t("cloud.sandbox.screen.open")} (${t("cloud.sandbox.screen.preview")})`
    : t("cloud.sandbox.screen.open");
  return <button type="button" className="cloud-screen-thumbnail" data-active={active || undefined}
    aria-pressed={active} aria-label={label} title={label} onClick={onOpen}>
    <svg className="cloud-screen-glyph" viewBox="0 0 20 16" aria-hidden="true">
      <rect className="cloud-screen-glyph-display" x="1.5" y="1.5" width="17" height="10.5" rx="2.25" />
      <path className="cloud-screen-glyph-stand" d="M10 12v2.25M7.25 14.5h5.5" />
    </svg>
  </button>;
}

export function CloudScreenView({ preview }: { preview: boolean }) {
  const { t } = useLocalization();
  return <section className="cloud-screen-view" aria-label={t("cloud.sandbox.screen.label")}>
    <div className="cloud-screen-view-display">
      <ScreenPlaceholder />
      {preview && <p className="cloud-screen-view-note" dir="auto">{t("cloud.sandbox.screen.preview-note")}</p>}
    </div>
  </section>;
}

function ScreenPlaceholder({ compact = false }: { compact?: boolean }) {
  return <span className="cloud-screen-placeholder" data-compact={compact || undefined}>
    <span className="cloud-screen-placeholder-taskbar" />
    <Monitor className="cloud-screen-placeholder-icon" aria-hidden="true" />
  </span>;
}
