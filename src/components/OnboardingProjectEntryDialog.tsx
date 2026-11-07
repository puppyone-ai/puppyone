import { CloudIcon, Tooltip, FolderIcon, LocalIcon } from "@puppyone/shared-ui";
import { Check, FolderPlus } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocalization } from "@puppyone/localization";
import type { CloudSpace } from "../lib/workspaceHomeModel";
import type { WorkspaceCreateProjectRequest, WorkspaceCreateProjectResult, WorkspaceProjectLocationGrant } from "../types/electron";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
} from "./DesktopDialog";
import { DesktopMenuItem, DesktopMenuSection, DesktopMenuSeparator, DesktopMenuSurface } from "./DesktopMenu";
import { useOnboardingMenu } from "./onboarding/useOnboardingMenu";

const GETTING_STARTED = {
  kind: "template",
  ref: { sourceId: "builtin", id: "puppyone.project.getting-started", version: 1 },
} as const;

/**
 * Project initialization dialog, the one way to start a project. The location is
 * prefilled with the built-in projects folder on this computer and the name is
 * prefilled, so the default path is a single Create action. The location can be
 * another folder or, signed in, one of the Cloud spaces, where the project starts
 * empty and shared with that space.
 */
export function OnboardingProjectEntryDialog({
  onClose,
  onDefaultLocation,
  onChooseLocation,
  onSubmit,
  cloudSpaces,
  onCreateCloudProject,
}: {
  onClose: () => void;
  onDefaultLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onChooseLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onSubmit: (request: WorkspaceCreateProjectRequest) => Promise<WorkspaceCreateProjectResult>;
  /** Spaces this account can start projects in; without any, the location is a folder. */
  cloudSpaces?: readonly CloudSpace[];
  onCreateCloudProject?: (spaceId: string, name: string) => Promise<void>;
}) {
  const { t, locale } = useLocalization();
  const [value, setValue] = useState(() => (
    `${t("onboarding.entry.create.defaultName")} ${crypto.randomUUID().slice(0, 4).toUpperCase()}`
  ));
  const requestRef = useRef<WorkspaceCreateProjectRequest | null>(null);
  const [created, setCreated] = useState<WorkspaceCreateProjectResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [choosingLocation, setChoosingLocation] = useState(false);
  const [location, setLocation] = useState<WorkspaceProjectLocationGrant | null>(null);
  /** A Cloud space instead of the folder above; null keeps the project on this computer. */
  const [space, setSpace] = useState<CloudSpace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const placeMenu = useOnboardingMenu();
  const spaces = onCreateCloudProject ? cloudSpaces ?? [] : [];
  const spaceLabel = (option: CloudSpace) => option.kind === "personal" ? t("onboarding.sharing.personal") : option.name;
  const defaultLocationRequest = useRef<Promise<WorkspaceProjectLocationGrant | null> | null>(null);
  const busy = submitting || choosingLocation;
  const fieldsDisabled = busy || created !== null;
  const title = t("onboarding.entry.create.title");

  useEffect(() => {
    if (!onDefaultLocation) return;
    defaultLocationRequest.current ??= onDefaultLocation();
    let cancelled = false;
    void defaultLocationRequest.current
      .then((grant) => {
        if (!cancelled && grant) setLocation((current) => current ?? grant);
      })
      .catch(() => {
        // The default folder is a convenience; Browse remains available.
      });
    return () => {
      cancelled = true;
    };
  }, [onDefaultLocation]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = value.trim();
    if (!name || busy || (!space && !location)) return;
    setError(null);
    setSubmitting(true);
    if (space && onCreateCloudProject) {
      try {
        await onCreateCloudProject(space.id, name);
        onClose();
        return;
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      }
      setSubmitting(false);
      return;
    }
    if (!location) return;
    try {
      requestRef.current ??= {
        name,
        locationGrantId: location.grantId,
        operationId: crypto.randomUUID(),
        locale,
        source: GETTING_STARTED,
      };
      const result = await onSubmit(requestRef.current);
      if (result.opening.status === "opened") {
        onClose();
        return;
      }
      setCreated(result);
      setError(result.opening.message);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
    setSubmitting(false);
  };

  const chooseLocation = async () => {
    if (!onChooseLocation || busy) return;
    setError(null);
    setChoosingLocation(true);
    try {
      const nextLocation = await onChooseLocation();
      if (nextLocation) {
        setLocation(nextLocation);
        setSpace(null);
        requestRef.current = null;
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setChoosingLocation(false);
    }
  };

  return (
    <DesktopDialogRoot
      onClose={busy ? undefined : onClose}
      dismissOnBackdrop={!busy}
      className="onboarding-entry-dialog-root"
    >
      <form
        className="desktop-dialog-surface desktop-file-dialog onboarding-entry-dialog is-create"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
      >
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row">
            <span className="desktop-dialog-leading file" aria-hidden="true">
              <FolderPlus size={16} strokeWidth={1.8} />
            </span>
            <h2>{title}</h2>
          </div>
          <Tooltip content={t("common.action.close")}><DesktopDialogCloseButton
            label={t("common.action.close")}
            disabled={busy}
            onClick={onClose}
          /></Tooltip>
        </header>

        <div className="desktop-dialog-body desktop-file-dialog-body onboarding-entry-dialog-body">
          <div className="onboarding-entry-create-fields">
            <label className="onboarding-entry-create-field">
              <span className="onboarding-entry-create-label">
                {t("onboarding.entry.create.nameLabel")}
              </span>
              <input
                className="onboarding-entry-create-input"
                value={value}
                type="text"
                inputMode="text"
                maxLength={120}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                disabled={fieldsDisabled}
                data-desktop-dialog-initial-focus="true"
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  setValue(event.target.value);
                  requestRef.current = null;
                  setError(null);
                }}
              />
            </label>
            <div className="onboarding-entry-create-field">
              <span className="onboarding-entry-create-label">
                {t("onboarding.entry.create.locationLabel")}
              </span>
              <div ref={placeMenu.rootRef} className="onboarding-entry-location-root">
                <button
                  className="onboarding-entry-location-picker onboarding-entry-browse-button"
                  type="button"
                  disabled={fieldsDisabled || (!onChooseLocation && spaces.length === 0)}
                  aria-label={t("onboarding.entry.create.locationLabel")}
                  aria-haspopup={spaces.length ? "menu" : undefined}
                  aria-expanded={spaces.length ? placeMenu.open : undefined}
                  onClick={() => spaces.length ? placeMenu.toggle() : void chooseLocation()}
                >
                  {space ? <CloudIcon aria-hidden="true" /> : <FolderIcon aria-hidden="true" />}
                  <bdi
                    className={`onboarding-entry-location-path ${location || space ? "is-selected" : ""}`}
                    dir={space ? undefined : "ltr"}
                    aria-live="polite"
                  >
                    {space ? spaceLabel(space) : location?.path ?? t("onboarding.entry.create.locationPlaceholder")}
                  </bdi>
                  <span className="onboarding-entry-location-action">
                    {t(choosingLocation
                      ? "onboarding.entry.create.browsing"
                      : location || space
                        ? "onboarding.entry.create.change"
                        : "onboarding.entry.create.browse")}
                  </span>
                </button>
                {placeMenu.open && (
                  <DesktopMenuSurface ref={placeMenu.menuRef} className="onboarding-entry-location-menu"
                    ariaLabel={t("onboarding.entry.create.locationLabel")} onKeyDown={placeMenu.onKeyDown}>
                    <DesktopMenuSection>
                      <DesktopMenuItem role="menuitemradio" aria-checked={!space}
                        icon={<LocalIcon size={14} strokeWidth={1.85} aria-hidden="true" />}
                        label={t("onboarding.sharing.localOnly")}
                        detail={location ? <bdi dir="ltr">{location.path}</bdi> : undefined}
                        trailing={!space ? <Check size={14} strokeWidth={1.85} aria-hidden="true" /> : undefined}
                        disabled={!location}
                        onClick={() => { placeMenu.close(); setSpace(null); setError(null); }} />
                      {onChooseLocation && <DesktopMenuItem role="menuitem"
                        icon={<FolderIcon size={14} strokeWidth={1.85} aria-hidden="true" />}
                        label={`${t("onboarding.entry.create.locationPlaceholder")}…`}
                        onClick={() => { placeMenu.close(); void chooseLocation(); }} />}
                    </DesktopMenuSection>
                    <DesktopMenuSeparator />
                    <DesktopMenuSection>
                      {spaces.map((option) => <DesktopMenuItem key={option.id} role="menuitemradio"
                        aria-checked={space?.id === option.id}
                        icon={<CloudIcon size={14} strokeWidth={1.85} aria-hidden="true" />}
                        label={<bdi>{spaceLabel(option)}</bdi>}
                        detail={option.kind === "team" ? t("onboarding.sharing.team") : undefined}
                        trailing={space?.id === option.id ? <Check size={14} strokeWidth={1.85} aria-hidden="true" /> : undefined}
                        onClick={() => { placeMenu.close(); setSpace(option); setError(null); }} />)}
                    </DesktopMenuSection>
                  </DesktopMenuSurface>
                )}
              </div>
            </div>
          </div>
          {created && <p className="onboarding-entry-dialog-note" role="status">{t("onboarding.entry.create.createdNote", { path: created.initialization.path })}</p>}
          {error && <p className="desktop-dialog-error" role="alert">{error}</p>}
        </div>

        <footer className="desktop-dialog-footer">
          <button
            className="desktop-dialog-button"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            {t("common.action.cancel")}
          </button>
          <button
            className="desktop-dialog-button primary file"
            type="submit"
            disabled={busy || !value.trim() || (!space && !location)}
          >
            {t(submitting
              ? "onboarding.entry.create.submitting"
              : created ? "onboarding.entry.create.retryOpen" : "onboarding.entry.create.submit")}
          </button>
        </footer>
      </form>
    </DesktopDialogRoot>
  );
}
