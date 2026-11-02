import { Tooltip, FolderIcon } from "@puppyone/shared-ui";
import { FolderPlus } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocalization } from "@puppyone/localization";
import { DesktopDialogCloseButton, DesktopDialogRoot } from "./DesktopDialog";
import { useProjectTemplateImport } from "./useProjectTemplateImport";
import type {
  MarketplaceTemplateDetail,
  WorkspaceCreateProjectRequest,
  WorkspaceCreateProjectResult,
  WorkspaceProjectLocationGrant,
} from "../types/electron";

const NOT_IN_A_FOLDER_NAME = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const PROJECT_NAME_MAX_LENGTH = 120;

/** A template's display name is free text; a project's name is a folder name. */
export function projectNameFromTemplate(name: string): string {
  return name.replace(NOT_IN_A_FOLDER_NAME, " ").replace(/\s+/g, " ").trim()
    .slice(0, PROJECT_NAME_MAX_LENGTH).replace(/[. ]+$/, "");
}

type TemplateImportCardProps = {
  url: string;
  /** A Project is open here, and getting a copy must not take its place. */
  openInNewWindow: boolean;
  onClose: () => void;
  onDefaultLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onChooseLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onSubmit: (request: WorkspaceCreateProjectRequest) => Promise<WorkspaceCreateProjectResult>;
};

function messageOf(failure: unknown) {
  return failure instanceof Error ? failure.message : String(failure);
}

/** The destination and the one action. Retrying reuses the request, so it never creates twice. */
function useTemplateCopy({
  source,
  openInNewWindow,
  onClose,
  onDefaultLocation,
  onChooseLocation,
  onSubmit,
}: Pick<TemplateImportCardProps, "openInNewWindow" | "onClose" | "onDefaultLocation" | "onChooseLocation" | "onSubmit">
  & { source: WorkspaceCreateProjectRequest["source"] | null }) {
  const { locale } = useLocalization();
  const [name, setName] = useState("");
  const [location, setLocation] = useState<WorkspaceProjectLocationGrant | null>(null);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [choosingLocation, setChoosingLocation] = useState(false);
  const [created, setCreated] = useState<WorkspaceCreateProjectResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<WorkspaceCreateProjectRequest | null>(null);
  const defaultLocationRequest = useRef<Promise<WorkspaceProjectLocationGrant | null> | null>(null);
  const busy = submitting || choosingLocation;

  useEffect(() => {
    if (!onDefaultLocation) return undefined;
    defaultLocationRequest.current ??= onDefaultLocation();
    let cancelled = false;
    void defaultLocationRequest.current
      .then((grant) => { if (!cancelled && grant) setLocation((current) => current ?? grant); })
      .catch(() => setEditing(true)); // The default folder is a convenience; Change remains available.
    return () => { cancelled = true; };
  }, [onDefaultLocation]);

  const submit = async () => {
    const projectName = name.trim();
    if (!projectName || busy || !location || !source) return;
    setError(null);
    setSubmitting(true);
    try {
      requestRef.current ??= {
        name: projectName,
        locationGrantId: location.grantId,
        operationId: crypto.randomUUID(),
        numberIfTaken: true,
        openInNewWindow,
        locale,
        source,
      };
      const result = await onSubmit(requestRef.current);
      if (result.opening.status === "opened") {
        onClose();
        return;
      }
      setCreated(result);
      setError(result.opening.message);
    } catch (failure) {
      setError(messageOf(failure));
    }
    setSubmitting(false);
  };

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
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setChoosingLocation(false);
    }
  };

  const rename = (next: string) => {
    setName(next);
    requestRef.current = null;
    setError(null);
  };

  return { name, setName, rename, location, editing, setEditing, submitting, choosingLocation, created, error, busy, submit, chooseLocation };
}

function TemplateSummary({ template }: { template: MarketplaceTemplateDetail }) {
  const { t } = useLocalization();
  const facts = [
    template.author,
    template.fileCount === null ? null : t("onboarding.template.fileCount", { count: template.fileCount }),
  ].filter(Boolean).join(" · ");
  return <>
    <div className="onboarding-entry-template-identity">
      <span className="onboarding-entry-template-icon" aria-hidden="true">{template.icon ?? <FolderIcon />}</span>
      <div>
        <h3 className="onboarding-entry-template-name">{template.name}</h3>
        {facts && <p className="onboarding-entry-template-facts">{facts}</p>}
      </div>
    </div>
    {template.description && <p className="onboarding-entry-template-description">{template.description}</p>}
  </>;
}

function locationActionKey(choosing: boolean, hasLocation: boolean) {
  if (choosing) return "onboarding.entry.create.browsing";
  return hasLocation ? "onboarding.entry.create.change" : "onboarding.entry.create.browse";
}

/** Only for someone who asked to change them: the defaults are the common case. */
function TemplateDestinationFields({ copy, canChooseLocation }: { copy: ReturnType<typeof useTemplateCopy>; canChooseLocation: boolean }) {
  const { t } = useLocalization();
  const locked = copy.busy || copy.created !== null;
  return <div className="onboarding-entry-create-fields">
    <label className="onboarding-entry-create-field">
      <span className="onboarding-entry-create-label">{t("onboarding.entry.create.nameLabel")}</span>
      <input
        className="onboarding-entry-create-input"
        value={copy.name}
        type="text"
        maxLength={PROJECT_NAME_MAX_LENGTH}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        disabled={locked}
        onChange={(event) => copy.rename(event.target.value)}
      />
    </label>
    <div className="onboarding-entry-create-field">
      <span className="onboarding-entry-create-label">{t("onboarding.entry.create.locationLabel")}</span>
      <button
        className="onboarding-entry-location-picker onboarding-entry-browse-button"
        type="button"
        disabled={locked || !canChooseLocation}
        aria-label={t("onboarding.entry.create.locationLabel")}
        onClick={() => void copy.chooseLocation()}
      >
        <FolderIcon aria-hidden="true" />
        <bdi className={`onboarding-entry-location-path ${copy.location ? "is-selected" : ""}`} dir="ltr" aria-live="polite">
          {copy.location?.path ?? t("onboarding.entry.create.locationPlaceholder")}
        </bdi>
        <span className="onboarding-entry-location-action">{t(locationActionKey(copy.choosingLocation, Boolean(copy.location)))}</span>
      </button>
    </div>
  </div>;
}

function TemplateDestinationSummary({ copy }: { copy: ReturnType<typeof useTemplateCopy> }) {
  const { t } = useLocalization();
  // A long path would be cut off at the end, which is the part that matters.
  const folder = copy.location?.path.split(/[\\/]/).filter(Boolean).pop();
  return <div className="onboarding-entry-template-destination">
    <Tooltip content={copy.location ? `${copy.location.path}/${copy.name}` : t("onboarding.entry.create.locationPlaceholder")}>
      <bdi dir="ltr" tabIndex={0}>{folder ? `${folder}/${copy.name}` : t("onboarding.entry.create.locationPlaceholder")}</bdi>
    </Tooltip>
    <button type="button" disabled={copy.busy || copy.created !== null} onClick={() => copy.setEditing(true)}>
      {t("onboarding.entry.create.change")}
    </button>
  </div>;
}

function submitLabelKey(submitting: boolean, created: boolean) {
  if (submitting) return "onboarding.entry.create.submitting";
  return created ? "onboarding.entry.create.retryOpen" : "onboarding.template.getCopy";
}

/**
 * What a template link opens: the template and one action. The name and the
 * place have good defaults, so asking about them waits until someone wants to
 * change them. Nothing is created until the user confirms.
 */
export function TemplateImportCard(props: TemplateImportCardProps) {
  const { url, onClose, onChooseLocation } = props;
  const { t, locale } = useLocalization();
  const { template, resolving, needsSignIn, error: resolveError, retry, auth, source } = useProjectTemplateImport(url, locale);
  const copy = useTemplateCopy({ ...props, source: needsSignIn ? null : source });
  const { setName } = copy;
  const { busy } = copy;
  const title = t("onboarding.template.title");

  useEffect(() => {
    if (template) setName(projectNameFromTemplate(template.name) || t("onboarding.entry.create.defaultName"));
  }, [setName, t, template]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void copy.submit();
  };
  const ready = Boolean(source) && !needsSignIn && !resolving && Boolean(copy.name.trim()) && Boolean(copy.location);
  const messages = [resolveError, auth.error, copy.error].filter((message): message is string => Boolean(message));

  return (
    <DesktopDialogRoot onClose={busy ? undefined : onClose} dismissOnBackdrop={!busy} className="onboarding-entry-dialog-root">
      <form
        className="desktop-dialog-surface desktop-file-dialog onboarding-entry-dialog is-create"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
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
          {resolving && <p className="onboarding-entry-dialog-note" role="status">{t("onboarding.template.loading")}</p>}
          {template && <div className="onboarding-entry-template">
            <TemplateSummary template={template} />
            {copy.editing
              ? <TemplateDestinationFields copy={copy} canChooseLocation={Boolean(onChooseLocation)} />
              : <TemplateDestinationSummary copy={copy} />}
          </div>}
          {needsSignIn && <button className="desktop-dialog-button" type="button" disabled={auth.signingIn} onClick={auth.startSignIn}>
            {t(auth.signingIn ? "onboarding.template.signingIn" : "onboarding.template.signIn")}
          </button>}
          {copy.created && <p className="onboarding-entry-dialog-note" role="status">
            {t("onboarding.entry.create.createdNote", { path: copy.created.initialization.path })}
          </p>}
          {messages.map((message) => <p key={message} className="desktop-dialog-error" role="alert">{message}</p>)}
        </div>

        <footer className="desktop-dialog-footer">
          <button className="desktop-dialog-button" type="button" disabled={busy} onClick={onClose}>{t("common.action.cancel")}</button>
          {resolveError
            ? <button className="desktop-dialog-button primary file" type="button" onClick={() => void retry()}>{t("common.action.retry")}</button>
            : <button className="desktop-dialog-button primary file" type="submit" disabled={busy || !ready}>
              {t(submitLabelKey(copy.submitting, copy.created !== null))}
            </button>}
        </footer>
      </form>
    </DesktopDialogRoot>
  );
}
