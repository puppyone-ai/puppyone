import { CloudIcon, FolderIcon, Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { Cpu, Monitor } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { DesktopDialogCloseButton, DesktopDialogRoot } from "../../components/DesktopDialog";
import type { CloudSpace } from "../../lib/workspaceHomeModel";
import type {
  WorkspaceCreateProjectRequest,
  WorkspaceCreateProjectResult,
  WorkspaceProjectLocationGrant,
} from "../../types/electron";
import { useLocalComputers } from "./useLocalComputers";

const GETTING_STARTED = {
  kind: "template",
  ref: { sourceId: "builtin", id: "puppyone.project.getting-started", version: 2 },
} as const;

type ComputerDestination = "cloud" | "on-device";

export type ComputerModeEntryDialogProps = Readonly<{
  onClose: () => void;
  onDefaultLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onChooseLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onSubmit: (request: WorkspaceCreateProjectRequest) => Promise<WorkspaceCreateProjectResult>;
  cloudSpaces?: readonly CloudSpace[];
  onCreateCloudProject?: (spaceId: string, name: string, operationId: string) => Promise<void>;
}>;

export function ComputerModeEntryDialog({
  onClose,
  onDefaultLocation,
  onChooseLocation,
  onSubmit,
  cloudSpaces,
  onCreateCloudProject,
}: ComputerModeEntryDialogProps) {
  const { t, locale } = useLocalization();
  const { runtime, registerComputer } = useLocalComputers();
  const creatableSpaces = onCreateCloudProject
    ? (cloudSpaces ?? []).filter((space) => space.canCreateProjects)
    : [];
  const canCreateInCloud = creatableSpaces.length > 0 && Boolean(onCreateCloudProject);

  const [destination, setDestination] = useState<ComputerDestination>(() => (
    canCreateInCloud ? "cloud" : "on-device"
  ));
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [value, setValue] = useState(() => (
    `${t("onboarding.computerMode.dialog.defaultName")} ${crypto.randomUUID().slice(0, 4).toUpperCase()}`
  ));
  const [location, setLocation] = useState<WorkspaceProjectLocationGrant | null>(null);
  const [choosingLocation, setChoosingLocation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestRef = useRef<WorkspaceCreateProjectRequest | null>(null);
  const cloudOpRef = useRef<{ attempt: string; id: string } | null>(null);
  const defaultLocationPromise = useRef<Promise<WorkspaceProjectLocationGrant | null> | null>(null);

  const activeSpace = creatableSpaces.find((space) => space.id === spaceId) ?? creatableSpaces[0];
  const effectiveDestination: ComputerDestination = destination === "cloud" && canCreateInCloud
    ? "cloud"
    : "on-device";
  const inCloud = effectiveDestination === "cloud";
  const busy = submitting || choosingLocation;

  useEffect(() => {
    if (!onDefaultLocation) return;
    defaultLocationPromise.current ??= onDefaultLocation();
    let cancelled = false;
    void defaultLocationPromise.current
      .then((grant) => {
        if (!cancelled && grant) setLocation((current) => current ?? grant);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [onDefaultLocation]);

  const chooseLocation = async () => {
    if (!onChooseLocation || busy) return;
    setError(null);
    setChoosingLocation(true);
    try {
      const next = await onChooseLocation();
      if (next) {
        setLocation(next);
        requestRef.current = null;
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setChoosingLocation(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = value.trim();
    if (!name || busy) return;
    if (inCloud && !activeSpace) return;
    if (!inCloud && !location) return;

    setError(null);
    setSubmitting(true);

    if (inCloud && activeSpace && onCreateCloudProject) {
      const attempt = `${activeSpace.id}\n${name}`;
      if (cloudOpRef.current?.attempt !== attempt) {
        cloudOpRef.current = { attempt, id: crypto.randomUUID() };
      }
      try {
        await onCreateCloudProject(activeSpace.id, name, cloudOpRef.current.id);
        onClose();
        return;
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
        setSubmitting(false);
        return;
      }
    }

    if (!location) {
      setSubmitting(false);
      return;
    }

    try {
      requestRef.current ??= {
        name,
        locationGrantId: location.grantId,
        operationId: crypto.randomUUID(),
        numberIfTaken: true,
        locale,
        source: GETTING_STARTED,
      };
      const result = await onSubmit(requestRef.current);
      if (result.opening.status === "opened") {
        const openedPath = result.opening.result.workspace?.path
          ?? result.opening.result.path
          ?? result.initialization.path;
        await registerComputer({
          workspacePath: openedPath,
          name,
          startNow: true,
        }).catch(() => undefined);
        onClose();
        return;
      }
      setError(result.opening.message);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
    setSubmitting(false);
  };

  const title = t("onboarding.computerMode.dialog.title");
  const runtimeBadge = runtime.available
    ? t("onboarding.computerMode.dialog.runtimeReady")
    : t("onboarding.computerMode.dialog.runtimeManaged");
  let locationActionKey = "onboarding.entry.create.browse";
  if (location) locationActionKey = "onboarding.entry.create.change";
  if (choosingLocation) locationActionKey = "onboarding.entry.create.browsing";
  const submitKey = submitting
    ? "onboarding.computerMode.dialog.submitting"
    : "onboarding.computerMode.dialog.submit";

  return (
    <DesktopDialogRoot
      onClose={busy ? undefined : onClose}
      dismissOnBackdrop={!busy}
      className="onboarding-entry-dialog-root"
    >
      <form
        className="desktop-dialog-surface desktop-file-dialog onboarding-entry-dialog computer-mode-entry-dialog is-create"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
      >
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row">
            <span className="desktop-dialog-leading file" aria-hidden="true">
              <Monitor size={16} strokeWidth={1.85} />
            </span>
            <h2>{title}</h2>
          </div>
          <Tooltip content={t("common.action.close")}>
            <DesktopDialogCloseButton
              label={t("common.action.close")}
              disabled={busy}
              onClick={onClose}
            />
          </Tooltip>
        </header>

        <div className="desktop-dialog-body desktop-file-dialog-body onboarding-entry-dialog-body">
          <div className="onboarding-entry-create-fields">
            <div className="onboarding-entry-create-field">
              <span className="onboarding-entry-create-label">
                {t("onboarding.computerMode.dialog.whereLabel")}
              </span>
              <div
                className="computer-mode-destination-grid"
                role="radiogroup"
                aria-label={t("onboarding.computerMode.dialog.whereLabel")}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={inCloud}
                  disabled={busy || !canCreateInCloud}
                  className="computer-mode-destination-card"
                  data-selected={inCloud || undefined}
                  data-destination="cloud"
                  onClick={() => {
                    setDestination("cloud");
                    setError(null);
                  }}
                >
                  <span className="computer-mode-destination-head">
                    <span className="computer-mode-destination-icon is-cloud" aria-hidden="true">
                      <CloudIcon size={16} strokeWidth={1.8} />
                    </span>
                    <span className="computer-mode-destination-title">
                      {t("onboarding.computerMode.dialog.cloudTitle")}
                    </span>
                  </span>
                  <span className="computer-mode-destination-detail">
                    {canCreateInCloud
                      ? t("onboarding.computerMode.dialog.cloudDetail")
                      : t("onboarding.computerMode.dialog.cloudUnavailable")}
                  </span>
                </button>

                <button
                  type="button"
                  role="radio"
                  aria-checked={!inCloud}
                  disabled={busy}
                  className="computer-mode-destination-card"
                  data-selected={!inCloud || undefined}
                  data-destination="on-device"
                  onClick={() => {
                    setDestination("on-device");
                    setError(null);
                  }}
                >
                  <span className="computer-mode-destination-head">
                    <span className="computer-mode-destination-icon is-device" aria-hidden="true">
                      <Cpu size={16} strokeWidth={1.8} />
                    </span>
                    <span className="computer-mode-destination-title">
                      {t("onboarding.computerMode.dialog.onDeviceTitle")}
                    </span>
                  </span>
                  <span className="computer-mode-destination-detail">
                    {t("onboarding.computerMode.dialog.onDeviceDetail")}
                  </span>
                  <span className="computer-mode-destination-badge">{runtimeBadge}</span>
                </button>
              </div>
            </div>

            <label className="onboarding-entry-create-field">
              <span className="onboarding-entry-create-label">
                {t("onboarding.computerMode.dialog.nameLabel")}
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
                disabled={busy}
                data-desktop-dialog-initial-focus="true"
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  setValue(event.target.value);
                  requestRef.current = null;
                  setError(null);
                }}
              />
            </label>

            {inCloud && creatableSpaces.length > 1 && (
              <label className="onboarding-entry-create-field">
                <span className="onboarding-entry-create-label">
                  {t("onboarding.sharing.selectTeam")}
                </span>
                <select
                  className="onboarding-entry-create-input"
                  value={activeSpace?.id ?? ""}
                  disabled={busy}
                  onChange={(event) => setSpaceId(event.target.value)}
                >
                  {creatableSpaces.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {!inCloud && (
              <div className="onboarding-entry-create-field">
                <span className="onboarding-entry-create-label">
                  {t("onboarding.entry.create.locationLabel")}
                </span>
                <button
                  className="onboarding-entry-location-picker onboarding-entry-browse-button"
                  type="button"
                  disabled={busy || !onChooseLocation}
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
                  <span className="onboarding-entry-location-action">{t(locationActionKey)}</span>
                </button>
              </div>
            )}
          </div>

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
            disabled={busy || !value.trim() || (inCloud ? !activeSpace : !location)}
          >
            {t(submitKey)}
          </button>
        </footer>
      </form>
    </DesktopDialogRoot>
  );
}
