import { FolderOpen, FolderPlus } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocalization } from "@puppyone/localization";
import type { WorkspaceCreateProjectRequest, WorkspaceCreateProjectResult, WorkspaceProjectLocationGrant } from "../types/electron";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
} from "./DesktopDialog";

/**
 * Project initialization dialog. The location is prefilled with the built-in
 * projects folder so the default path is name → Enter, with no folder picker.
 * Browse remains available as "Change" for people who want another location.
 */
export function OnboardingProjectEntryDialog({
  onClose,
  onDefaultLocation,
  onChooseLocation,
  onSubmit,
}: {
  onClose: () => void;
  onDefaultLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onChooseLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onSubmit: (request: WorkspaceCreateProjectRequest) => Promise<WorkspaceCreateProjectResult>;
}) {
  const { t, locale } = useLocalization();
  const [value, setValue] = useState("");
  const [starter, setStarter] = useState<"get-started" | "blank">("get-started");
  const requestRef = useRef<WorkspaceCreateProjectRequest | null>(null);
  const [created, setCreated] = useState<WorkspaceCreateProjectResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [choosingLocation, setChoosingLocation] = useState(false);
  const [location, setLocation] = useState<WorkspaceProjectLocationGrant | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    if (!name || busy || !location) return;
    setError(null);
    setSubmitting(true);
    try {
      requestRef.current ??= {
        name,
        locationGrantId: location.grantId,
        operationId: crypto.randomUUID(),
        locale,
        source: starter === "blank" ? { kind: "blank" } : {
          kind: "template",
          ref: { sourceId: "builtin", id: "puppyone.project.getting-started", version: 1 },
        },
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
          <DesktopDialogCloseButton
            title={t("common.action.close")}
            disabled={busy}
            onClick={onClose}
          />
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
                placeholder={t("onboarding.entry.create.namePlaceholder")}
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
              <button
                className="onboarding-entry-location-picker onboarding-entry-browse-button"
                type="button"
                disabled={fieldsDisabled || !onChooseLocation}
                aria-label={t("onboarding.entry.create.locationLabel")}
                onClick={() => void chooseLocation()}
              >
                <FolderOpen aria-hidden="true" />
                <bdi
                  className={`onboarding-entry-location-path ${location ? "is-selected" : ""}`}
                  dir="ltr"
                  title={location?.path}
                  aria-live="polite"
                >
                  {location?.path ?? t("onboarding.entry.create.locationPlaceholder")}
                </bdi>
                <span className="onboarding-entry-location-action">
                  {t(choosingLocation
                    ? "onboarding.entry.create.browsing"
                    : location
                      ? "onboarding.entry.create.change"
                      : "onboarding.entry.create.browse")}
                </span>
              </button>
              <p className="onboarding-entry-dialog-note onboarding-entry-local-note">
                {t("onboarding.entry.create.localNote")}
              </p>
            </div>
          </div>
          <label className="onboarding-entry-create-field">
            <span className="onboarding-entry-create-label">{t("onboarding.entry.create.starterLabel")}</span>
            <select
              className="onboarding-entry-create-input"
              value={starter}
              disabled={fieldsDisabled}
              onChange={(event) => {
                setStarter(event.target.value as "get-started" | "blank");
                requestRef.current = null;
                setError(null);
              }}
            >
              <option value="get-started">{t("onboarding.entry.create.starterGuide")}</option>
              <option value="blank">{t("onboarding.entry.create.starterBlank")}</option>
            </select>
            <span className="onboarding-entry-dialog-note">{t(starter === "blank" ? "onboarding.entry.create.blankNote" : "onboarding.entry.create.guideNote")}</span>
          </label>
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
            disabled={busy || !value.trim() || !location}
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
