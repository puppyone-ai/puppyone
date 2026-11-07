import { CloudIcon, Tooltip, FolderIcon, LocalIcon } from "@puppyone/shared-ui";
import { FolderPlus } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocalization } from "@puppyone/localization";
import type { CloudSpace } from "../lib/workspaceHomeModel";
import type { WorkspaceCreateProjectRequest, WorkspaceCreateProjectResult, WorkspaceProjectLocationGrant } from "../types/electron";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
} from "./DesktopDialog";

const GETTING_STARTED = {
  kind: "template",
  ref: { sourceId: "builtin", id: "puppyone.project.getting-started", version: 1 },
} as const;

/** Who can open the new project: the same three audiences as the Homepage's groups. */
type Audience = "local" | "devices" | "team";
/** Where its files are kept. Only all-my-devices offers a choice. */
type Storage = "computer" | "cloud";

/**
 * Project initialization dialog, the one way to start a project. It asks who can open
 * the project, then where it is stored, offering only what that audience allows: this
 * computer alone is always this computer, a team is always the Cloud, and all my
 * devices may be either a folder here shared with them or the Cloud. The name and the
 * built-in projects folder are prefilled, so the default path is a single Create action.
 */
export function OnboardingProjectEntryDialog({
  onClose,
  onDefaultLocation,
  onChooseLocation,
  onSubmit,
  cloudSpaces,
  onCreateCloudProject,
  onShareWithMyDevices,
}: {
  onClose: () => void;
  onDefaultLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onChooseLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onSubmit: (request: WorkspaceCreateProjectRequest) => Promise<WorkspaceCreateProjectResult>;
  /** Spaces this account can start projects in. */
  cloudSpaces?: readonly CloudSpace[];
  onCreateCloudProject?: (spaceId: string, name: string) => Promise<void>;
  /** Offers a project just created and opened here to the owner's other computers. */
  onShareWithMyDevices?: (path: string) => Promise<void>;
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
  const [error, setError] = useState<string | null>(null);
  const defaultLocationRequest = useRef<Promise<WorkspaceProjectLocationGrant | null> | null>(null);
  const busy = submitting || choosingLocation;
  const fieldsDisabled = busy || created !== null;
  const title = t("onboarding.entry.create.title");

  const spaces = onCreateCloudProject ? (cloudSpaces ?? []).filter((space) => space.canCreateProjects) : [];
  const personal = spaces.find((space) => space.kind === "personal");
  const teams = spaces.filter((space) => space.kind === "team");
  const devicesStorage: Storage[] = [
    ...(onShareWithMyDevices ? ["computer" as const] : []),
    ...(personal ? ["cloud" as const] : []),
  ];
  const audiences: Audience[] = ["local", ...(devicesStorage.length ? ["devices" as const] : []), ...(teams.length ? ["team" as const] : [])];
  const [audience, setAudience] = useState<Audience>("local");
  const [chosenStorage, setChosenStorage] = useState<Storage>("computer");
  const [teamId, setTeamId] = useState<string | null>(null);
  const team = teams.find((space) => space.id === teamId) ?? teams[0];
  const storageOptions = storageFor(audience, devicesStorage);
  const storage = storageOptions.includes(chosenStorage) ? chosenStorage : storageOptions[0];
  const cloudSpace = audience === "team" ? team : personal;

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

  const createInCloud = async (name: string) => {
    if (!cloudSpace || !onCreateCloudProject) return;
    try {
      await onCreateCloudProject(cloudSpace.id, name);
      onClose();
      return;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
    setSubmitting(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = value.trim();
    if (!name || busy || (storage === "computer" && !location)) return;
    setError(null);
    setSubmitting(true);
    if (storage === "cloud") {
      await createInCloud(name);
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
        if (audience === "devices") void onShareWithMyDevices?.(result.initialization.path);
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

  const audienceLabels: Record<Audience, string> = {
    local: t("onboarding.entry.create.audience.local"),
    devices: t("onboarding.entry.create.audience.devices"),
    team: t("onboarding.entry.create.audience.team"),
  };
  let locationAction = "onboarding.entry.create.browse";
  if (location) locationAction = "onboarding.entry.create.change";
  if (choosingLocation) locationAction = "onboarding.entry.create.browsing";
  let submitLabel = "onboarding.entry.create.submit";
  if (created) submitLabel = "onboarding.entry.create.retryOpen";
  if (submitting) submitLabel = "onboarding.entry.create.submitting";

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
            {audiences.length > 1 && (
              <fieldset className="onboarding-entry-create-field onboarding-entry-choice-field" disabled={fieldsDisabled}>
                <legend className="onboarding-entry-create-label">{t("onboarding.entry.create.audienceLabel")}</legend>
                <div className="onboarding-entry-choices" role="radiogroup">
                  {audiences.map((option) => (
                    <label key={option} className="onboarding-entry-choice" data-checked={audience === option || undefined}>
                      <input type="radio" name="onboarding-entry-audience" value={option} checked={audience === option}
                        onChange={() => { setAudience(option); setError(null); }} />
                      <span className="onboarding-entry-choice-label">{audienceLabels[option]}</span>
                      {option === "team" && teams.length > 1 && (
                        <select className="onboarding-entry-team-select" aria-label={t("onboarding.sharing.selectTeam")}
                          value={team?.id} onChange={(event) => { setTeamId(event.target.value); setAudience("team"); }}>
                          {teams.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
                        </select>
                      )}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="onboarding-entry-create-field">
              <span className="onboarding-entry-create-label">
                {t(audiences.length > 1 ? "onboarding.entry.create.storedLabel" : "onboarding.entry.create.locationLabel")}
              </span>
              {storageOptions.length > 1 && (
                <div className="onboarding-entry-segments" role="radiogroup" aria-label={t("onboarding.entry.create.storedLabel")}>
                  {storageOptions.map((option) => (
                    <label key={option} className="onboarding-entry-segment" data-checked={storage === option || undefined}>
                      <input type="radio" name="onboarding-entry-storage" value={option} checked={storage === option}
                        disabled={fieldsDisabled} onChange={() => { setChosenStorage(option); setError(null); }} />
                      {option === "computer" ? <LocalIcon size={14} strokeWidth={1.85} aria-hidden="true" />
                        : <CloudIcon size={14} strokeWidth={1.85} aria-hidden="true" />}
                      <span>{t(`onboarding.entry.create.stored.${option}`)}</span>
                    </label>
                  ))}
                </div>
              )}
              {storage === "computer" ? (
                <button
                  className="onboarding-entry-location-picker onboarding-entry-browse-button"
                  type="button"
                  disabled={fieldsDisabled || !onChooseLocation}
                  aria-label={t("onboarding.entry.create.locationLabel")}
                  onClick={() => void chooseLocation()}
                >
                  <FolderIcon aria-hidden="true" />
                  <bdi
                    className={`onboarding-entry-location-path ${location ? "is-selected" : ""}`}
                    dir="ltr"
                    aria-live="polite"
                  >
                    {location?.path ?? t("onboarding.entry.create.locationPlaceholder")}
                  </bdi>
                  <span className="onboarding-entry-location-action">{t(locationAction)}</span>
                </button>
              ) : storageOptions.length === 1 && (
                <div className="onboarding-entry-location-picker is-fixed" aria-live="polite">
                  <CloudIcon aria-hidden="true" />
                  <span className="onboarding-entry-location-path is-selected">{t("onboarding.entry.create.stored.cloud")}</span>
                </div>
              )}
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
            disabled={busy || !value.trim() || (storage === "computer" && !location) || (storage === "cloud" && !cloudSpace)}
          >
            {t(submitLabel)}
          </button>
        </footer>
      </form>
    </DesktopDialogRoot>
  );
}

function storageFor(audience: Audience, devices: readonly Storage[]): readonly Storage[] {
  if (audience === "team") return ["cloud"];
  if (audience === "devices") return devices;
  return ["computer"];
}
