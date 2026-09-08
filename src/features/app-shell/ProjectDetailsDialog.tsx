import { ImagePlus, RotateCcw } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import { useId } from "react";
import type { ProjectAppearance } from "../../types/electron";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../components/DesktopDialog";
import { DesktopOverlayLayer } from "./DesktopOverlayPortal";

const PROJECT_EMOJI_PRESETS = Object.freeze([
  "📁", "🧭", "🚀", "💡", "🧠", "🛠️",
  "🎨", "📚", "📊", "🔬", "🌱", "⚡️",
  "🏗️", "🧩", "🎯", "💻", "📝", "🔒",
]);

export type ProjectDetailsDialogProps = Readonly<{
  appearance: ProjectAppearance | null;
  error: string | null;
  initial: string;
  name: string;
  path: string;
  pending: boolean;
  onChooseImage: () => void | Promise<void>;
  onClose: () => void;
  onResetIcon: () => void | Promise<void>;
  onSelectEmoji: (emoji: string) => void | Promise<void>;
}>;

export function ProjectDetailsDialog({
  appearance,
  error,
  initial,
  name,
  path,
  pending,
  onChooseImage,
  onClose,
  onResetIcon,
  onSelectEmoji,
}: ProjectDetailsDialogProps) {
  const { t } = useLocalization();
  const title = t("shell.workspaceSwitcher.projectDetails");
  const iconHeadingId = useId();

  return (
    <DesktopOverlayLayer>
      <DesktopDialogRoot onClose={pending ? undefined : onClose}>
        <DesktopDialogSurface
          width={480}
          className="desktop-project-details-dialog"
          ariaLabel={title}
        >
          <header className="desktop-dialog-header desktop-project-details-header">
            <div className="desktop-dialog-title-row">
              <h2>{title}</h2>
            </div>
            <DesktopDialogCloseButton
              title={t("common.action.close")}
              disabled={pending}
              onClick={onClose}
            />
          </header>

          <div className="desktop-dialog-body desktop-project-details-body">
            <div className="desktop-project-details-identity">
              <ProjectDetailsAvatar
                appearance={appearance}
                initial={initial}
              />
              <div className="desktop-project-details-copy">
                <bdi className="desktop-project-details-name" dir="auto">{name}</bdi>
                <span className="desktop-project-details-path-label">
                  {t("shell.workspaceSwitcher.localPath")}
                </span>
                <bdi className="desktop-project-details-path" dir="ltr" title={path}>{path}</bdi>
              </div>
            </div>

            <section className="desktop-project-details-icon-section" aria-labelledby={iconHeadingId}>
              <div className="desktop-project-details-section-heading">
                <h3 id={iconHeadingId}>{t("shell.workspaceSwitcher.projectIcon")}</h3>
                <p>{t("shell.workspaceSwitcher.projectIconDescription")}</p>
              </div>

              <div className="desktop-project-details-icon-actions">
                <button
                  className="desktop-project-details-action"
                  type="button"
                  disabled={pending}
                  onClick={() => void onResetIcon()}
                >
                  <RotateCcw aria-hidden="true" />
                  <span>{t("shell.workspaceSwitcher.useInitial")}</span>
                </button>
                <button
                  className="desktop-project-details-action"
                  type="button"
                  disabled={pending}
                  onClick={() => void onChooseImage()}
                >
                  <ImagePlus aria-hidden="true" />
                  <span>{t("shell.workspaceSwitcher.uploadImage")}</span>
                </button>
              </div>

              <div
                className="desktop-project-details-emoji-grid"
                aria-label={t("shell.workspaceSwitcher.chooseEmoji")}
                aria-busy={pending || undefined}
              >
                {PROJECT_EMOJI_PRESETS.map((emoji) => {
                  const selected = appearance?.icon?.kind === "emoji"
                    && appearance.icon.value === emoji;
                  return (
                    <button
                      className="desktop-project-details-emoji"
                      type="button"
                      aria-pressed={selected}
                      aria-label={t("shell.workspaceSwitcher.useEmoji", { emoji })}
                      disabled={pending}
                      key={emoji}
                      onClick={() => void onSelectEmoji(emoji)}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>
            </section>
            {error && <p className="desktop-dialog-error" role="alert">{error}</p>}
          </div>
        </DesktopDialogSurface>
      </DesktopDialogRoot>
    </DesktopOverlayLayer>
  );
}

function ProjectDetailsAvatar({
  appearance,
  initial,
}: Readonly<{
  appearance: ProjectAppearance | null;
  initial: string;
}>) {
  const icon = appearance?.icon ?? null;
  return (
    <div
      className="desktop-project-details-avatar"
      data-avatar-kind={icon?.kind ?? "initial"}
      aria-hidden="true"
    >
      {icon?.kind === "asset" ? (
        <img src={icon.url} alt="" draggable="false" />
      ) : icon?.kind === "emoji" ? (
        <span>{icon.value}</span>
      ) : (
        <bdi>{initial}</bdi>
      )}
    </div>
  );
}
