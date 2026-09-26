import { ArrowLeft } from "lucide-react";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization";
import {
  DEFAULT_VISIBLE_IMPORT_SOURCES,
  IMPORT_SOURCE_REGISTRY,
  type ImportSourceBrand,
  type ImportSourceDescriptor,
  type LocalFolderImportSource,
  type RepositoryImportSource,
} from "../features/project-import/importSourceRegistry";
import type {
  WorkspaceCloneRepositoryRequest,
  WorkspaceImportLocalFolderRequest,
  WorkspaceProjectLocationGrant,
} from "../types/electron";
import { ImportLocationField, useImportLocation } from "../features/project-import/ImportLocationField";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
} from "./DesktopDialog";
import { ImportSourceMark } from "./onboarding/ImportSourceMark";

/**
 * Import is framed as "bring your work back into files you own", not as a Git
 * operation. GitHub and GitLab clone into a local project. Obsidian reads a
 * local vault. Remote providers require a direct connector before they can be
 * selected; their project files are published by the same Main coordinator.
 */
export type RepositoryProvider = RepositoryImportSource;
export type OnboardingImportSource = ImportSourceBrand;

const REPOSITORY_PROVIDER_LABELS: Record<RepositoryProvider, string> = {
  github: "GitHub",
  gitlab: "GitLab",
};

const REPOSITORY_PROVIDER_MARKS = {
  github: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  gitlab: "m23.6004 9.5927-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7489.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z",
} as const;

export function RepositoryProviderMark({ provider }: { provider: RepositoryProvider }) {
  return (
    <svg
      className={`is-${provider}`}
      data-repository-provider={provider}
      viewBox="0 0 24 24"
      fill="currentColor"
      focusable="false"
    >
      <path d={REPOSITORY_PROVIDER_MARKS[provider]} />
    </svg>
  );
}

export function detectRepositoryProvider(value: string): RepositoryProvider | null {
  const repositoryUrl = value.trim().toLowerCase();
  if (!repositoryUrl) return null;
  if (/^(?:(?:https?|ssh|git):\/\/(?:git@)?|git@)?github\.com[/:]/.test(repositoryUrl)) {
    return "github";
  }
  if (/^(?:(?:https?|ssh|git):\/\/(?:git@)?|git@)?gitlab\.com[/:]/.test(repositoryUrl)) {
    return "gitlab";
  }
  return null;
}

export type OnboardingImportDialogProps = {
  onClose: () => void;
  /** Issues a grant for the built-in projects folder without a picker. */
  onDefaultLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  /** Opens the native picker and issues a grant for the chosen folder. */
  onChooseLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onImportRepository: (request: WorkspaceCloneRepositoryRequest) => Promise<boolean>;
  onImportFolder: (request: WorkspaceImportLocalFolderRequest) => Promise<boolean>;
  /** Sources resolved from the shared capability and experiment registry. */
  visibleSources?: readonly ImportSourceDescriptor[];
};

export function OnboardingImportDialog({
  onClose,
  onDefaultLocation,
  onChooseLocation,
  onImportRepository,
  onImportFolder,
  visibleSources = DEFAULT_VISIBLE_IMPORT_SOURCES,
}: OnboardingImportDialogProps) {
  const { t } = useLocalization();
  const introId = useId();
  const [source, setSource] = useState<OnboardingImportSource | null>(null);
  const [busy, setBusy] = useState(false);
  const title = source === null
    ? t("onboarding.entry.import.title")
    : source === "github" || source === "gitlab"
      ? t("onboarding.entry.import.repository.title", { provider: REPOSITORY_PROVIDER_LABELS[source] })
    : t(`onboarding.entry.import.${source}.title`);

  const selectSource = (nextSource: OnboardingImportSource) => {
    setSource(nextSource);
  };

  return (
    <DesktopDialogRoot
      onClose={busy ? undefined : onClose}
      dismissOnBackdrop={!busy}
      className="onboarding-entry-dialog-root"
    >
      <div
        className={`desktop-dialog-surface desktop-file-dialog onboarding-entry-dialog is-import ${source ? `is-import-${source}` : "is-import-sources"}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={source === null ? introId : undefined}
        data-import-source={source ?? "sources"}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row">
            {source !== null && (
              <button
                className="onboarding-import-back"
                type="button"
                disabled={busy}
                aria-label={t("onboarding.entry.import.back")}
                title={t("onboarding.entry.import.back")}
                onClick={() => setSource(null)}
              >
                <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
            )}
            <h2>{title}</h2>
          </div>
          <DesktopDialogCloseButton
            title={t("common.action.close")}
            disabled={busy}
            onClick={onClose}
          />
        </header>

        {source === null && (
          <ImportSourceList
            introId={introId}
            onSelect={selectSource}
            visibleSources={visibleSources}
          />
        )}
        {(source === "github" || source === "gitlab") && (
          <RepositoryImportStep
            provider={source}
            onBusyChange={setBusy}
            onClose={onClose}
            onDefaultLocation={onDefaultLocation}
            onChooseLocation={onChooseLocation}
            onImportRepository={onImportRepository}
          />
        )}
        {source === "obsidian" && (
          <LocalFolderImportStep
            source={source}
            onBusyChange={setBusy}
            onClose={onClose}
            onDefaultLocation={onDefaultLocation}
            onChooseLocation={onChooseLocation}
            onImportFolder={onImportFolder}
          />
        )}
      </div>
    </DesktopDialogRoot>
  );
}

function ImportSourceList({
  introId,
  onSelect,
  visibleSources,
}: {
  introId: string;
  onSelect: (source: OnboardingImportSource) => void;
  visibleSources: readonly ImportSourceDescriptor[];
}) {
  const { t } = useLocalization();
  return (
    <div className="desktop-dialog-body desktop-file-dialog-body onboarding-entry-dialog-body">
      <p id={introId} className="onboarding-import-intro">{t("onboarding.entry.import.intro")}</p>
      <ul className="onboarding-import-sources">
        {visibleSources.map(({ id, mode, operational }, index) => (
          <ImportSourceRow
            key={id}
            source={id}
            mode={mode}
            icon={<ImportSourceMark brand={id} decorative />}
            title={id === "github" || id === "gitlab"
              ? REPOSITORY_PROVIDER_LABELS[id]
              : t(`onboarding.entry.import.source.${id}.title`)}
            initialFocus={index === 0}
            operational={operational}
            unavailableLabel={t("onboarding.entry.import.directUnavailable")}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  );
}

function ImportSourceRow({
  source,
  mode,
  icon,
  title,
  initialFocus = false,
  operational,
  unavailableLabel,
  onSelect,
}: {
  source: OnboardingImportSource;
  mode: "repository" | "remote" | "folder";
  icon: ReactNode;
  title: string;
  initialFocus?: boolean;
  operational: boolean;
  unavailableLabel: string;
  onSelect: (source: OnboardingImportSource) => void;
}) {
  return (
    <li>
      <button
        className="onboarding-import-source"
        type="button"
        data-import-source={source}
        data-import-mode={mode}
        data-desktop-dialog-initial-focus={initialFocus ? "true" : undefined}
        disabled={!operational}
        title={!operational ? unavailableLabel : undefined}
        onClick={() => onSelect(source)}
      >
        <span className="onboarding-import-source-icon" aria-hidden="true">{icon}</span>
        <span className="onboarding-import-source-label">{title}</span>
        {!operational && <span className="onboarding-import-source-status">{unavailableLabel}</span>}
      </button>
    </li>
  );
}

function LocalFolderImportStep({
  source,
  onBusyChange,
  onClose,
  onDefaultLocation,
  onChooseLocation,
  onImportFolder,
}: {
  source: LocalFolderImportSource;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onDefaultLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onChooseLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onImportFolder: OnboardingImportDialogProps["onImportFolder"];
}) {
  const { t } = useLocalization();
  const destination = useImportLocation({ onDefaultLocation, onChooseLocation });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const busy = submitting || destination.choosing || destination.resolvingDefault;
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  const stepCount = IMPORT_SOURCE_REGISTRY.find((entry) => entry.id === source)?.stepCount ?? 0;
  const steps = Array.from({ length: stepCount }, (_, index) => (
    t(`onboarding.entry.import.${source}.step${index + 1}`)
  ));

  const submit = async () => {
    if (busy) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const opened = await onImportFolder({ provider: source, locationGrantId: destination.location?.grantId ?? null });
      if (opened) {
        onClose();
        return;
      }
    } catch (nextError) {
      setSubmitError(nextError instanceof Error ? nextError.message : String(nextError));
    }
    setSubmitting(false);
  };

  return (
    <>
      <div className="desktop-dialog-body desktop-file-dialog-body onboarding-entry-dialog-body">
        <ol className="onboarding-import-steps">
          {steps.map((step, index) => <li key={index}>{step}</li>)}
        </ol>
        <p className="onboarding-import-outcome">{t(`onboarding.entry.import.${source}.outcome`)}</p>
        <ImportLocationField
          location={destination.location}
          choosing={destination.choosing}
          disabled={busy}
          canChoose={destination.canChoose}
          onChoose={() => void destination.choose()}
        />
        {(submitError || destination.error) && <p className="desktop-dialog-error" role="alert">{submitError || destination.error}</p>}
      </div>
      <footer className="desktop-dialog-footer">
        <button
          className="desktop-dialog-button primary file"
          type="button"
          data-desktop-dialog-initial-focus="true"
          disabled={busy}
          onClick={() => void submit()}
        >
          {t(submitting ? "onboarding.entry.clone.submitting" : `onboarding.entry.import.${source}.action`)}
        </button>
      </footer>
    </>
  );
}

function RepositoryImportStep({
  provider,
  onBusyChange,
  onClose,
  onDefaultLocation,
  onChooseLocation,
  onImportRepository,
}: {
  provider: RepositoryProvider;
  onBusyChange: (busy: boolean) => void;
  onClose: () => void;
  onDefaultLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onChooseLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onImportRepository: OnboardingImportDialogProps["onImportRepository"];
}) {
  const { t } = useLocalization();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const destination = useImportLocation({ onDefaultLocation, onChooseLocation });
  const [error, setError] = useState<string | null>(null);
  const detectedProvider = detectRepositoryProvider(value);
  const unsupportedUrl = value.trim().length > 0 && detectedProvider !== provider;
  const busy = submitting || destination.choosing || destination.resolvingDefault;

  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const repositoryUrl = value.trim();
    if (!repositoryUrl || busy || detectedProvider !== provider) return;
    setError(null);
    setSubmitting(true);
    try {
      const opened = await onImportRepository({
        provider,
        repositoryUrl,
        locationGrantId: destination.location?.grantId ?? null,
      });
      if (opened) {
        onClose();
        return;
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
    setSubmitting(false);
  };

  return (
    <form className="onboarding-import-repository-form" onSubmit={(event) => void submit(event)}>
      <div className="desktop-dialog-body desktop-file-dialog-body onboarding-entry-dialog-body">
        <div className="onboarding-clone-workflow">
          <label className="desktop-dialog-field onboarding-clone-url-field">
            <span className="onboarding-clone-url-label-row">
              <span>{t("onboarding.entry.clone.urlLabel")}</span>
              <span className="onboarding-clone-provider-marks" aria-hidden="true">
                <RepositoryProviderMark provider={provider} />
              </span>
            </span>
            <input
              value={value}
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              aria-invalid={unsupportedUrl ? "true" : undefined}
              aria-describedby="onboarding-clone-hint"
              data-desktop-dialog-initial-focus="true"
              placeholder={`https://${provider}.com/owner/repository.git`}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
            />
          </label>
          <p
            id="onboarding-clone-hint"
            className={`onboarding-entry-dialog-note onboarding-clone-hint ${unsupportedUrl ? "is-unsupported" : ""}`}
            role={unsupportedUrl ? "alert" : undefined}
          >
            {t(unsupportedUrl
              ? "onboarding.entry.clone.unsupportedUrl"
              : "onboarding.entry.chooseLocationHint", {
              provider: REPOSITORY_PROVIDER_LABELS[provider],
            })}
          </p>
          <ImportLocationField
            location={destination.location}
            choosing={destination.choosing}
            disabled={busy}
            canChoose={destination.canChoose}
            onChoose={() => void destination.choose()}
          />
        </div>
        {(error || destination.error) && <p className="desktop-dialog-error" role="alert">{error || destination.error}</p>}
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
          disabled={busy || !value.trim() || detectedProvider !== provider}
        >
          {t(submitting
            ? "onboarding.entry.clone.submitting"
            : "onboarding.entry.clone.submit")}
        </button>
      </footer>
    </form>
  );
}
