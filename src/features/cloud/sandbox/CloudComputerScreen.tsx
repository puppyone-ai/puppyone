import { Monitor } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import "./cloud-computer-screen.css";

/** The Cloud computer's screen in the sidebar footer; opening it shows the screen in the editor area. */
export function CloudScreenThumbnail({ preview, active, onOpen }: {
  preview: boolean;
  active: boolean;
  onOpen: () => void;
}) {
  const { t } = useLocalization();
  return <button type="button" className="cloud-screen-thumbnail" data-active={active || undefined}
    aria-pressed={active} aria-label={t("cloud.sandbox.screen.open")} onClick={onOpen}>
    <span className="cloud-screen-thumbnail-display" aria-hidden="true">
      <ScreenPlaceholder compact />
    </span>
    <span className="cloud-screen-thumbnail-caption">
      <span className="cloud-screen-thumbnail-status" data-preview={preview || undefined} aria-hidden="true" />
      <span className="cloud-screen-thumbnail-label">{t("cloud.sandbox.screen.label")}</span>
      {preview && <span className="cloud-screen-thumbnail-badge">{t("cloud.sandbox.screen.preview")}</span>}
    </span>
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
