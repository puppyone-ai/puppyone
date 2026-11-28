import { FolderIcon, Tooltip } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { WorkspaceCreateProjectRequest, WorkspaceCreateProjectResult, WorkspaceProjectLocationGrant } from "../types/electron";
import { HomepageAgentBrandMark } from "./onboarding/HomepageAgentStrip";
import { DesktopDialogCloseButton, DesktopDialogRoot } from "./DesktopDialog";

/** A project just made for an Agent, and the words to hand it once the project is open. */
export type AgentProjectStart = Readonly<{ rootPath: string; runtimeId: string; prompt: string }>;

export type AgentProjectStartAgent = Readonly<{ runtimeId: string; label: string; iconKey: string }>;

const BLANK = { kind: "blank" } as const;
const NAME_LIMIT = 32;

/**
 * A folder name from what the person asked for: its first phrase, without the
 * characters a folder may not have, or the usual default when there is none.
 */
export function suggestProjectName(prompt: string, fallback: string) {
  const first = prompt.split(/[\n。！？!?；;：:，,]/u)[0] ?? "";
  const cleaned = first.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const sliced = [...cleaned].slice(0, NAME_LIMIT).join("").replace(/[. ]+$/, "").trim();
  return sliced || fallback;
}

function locationActionKey(choosing: boolean, hasLocation: boolean) {
  if (choosing) return "onboarding.entry.create.browsing";
  return hasLocation ? "onboarding.entry.create.change" : "onboarding.entry.create.browse";
}

/**
 * Starts a project for one of the person's Agents. The words are the Agent's to act
 * on, so the field is the Agent's, with its mark and its name: puppyone only makes the
 * folder, opens it, and hands the words over. The name follows the words until it is
 * edited, and the project goes in the usual place, numbered if that name is taken.
 */
export function AgentProjectStartDialog({
  agent,
  openInNewWindow = false,
  onClose,
  onDefaultLocation,
  onChooseLocation,
  onSubmit,
  onStarted,
}: {
  agent: AgentProjectStartAgent;
  openInNewWindow?: boolean;
  onClose: () => void;
  onDefaultLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onChooseLocation?: () => Promise<WorkspaceProjectLocationGrant | null>;
  onSubmit: (request: WorkspaceCreateProjectRequest) => Promise<WorkspaceCreateProjectResult>;
  onStarted: (start: AgentProjectStart) => void;
}) {
  const { t, locale } = useLocalization();
  const name = bidiIsolate(agent.label);
  const title = t("onboarding.agents.start", { agent: name });
  const [prompt, setPrompt] = useState("");
  const [editedName, setEditedName] = useState<string | null>(null);
  const [location, setLocation] = useState<WorkspaceProjectLocationGrant | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [choosingLocation, setChoosingLocation] = useState(false);
  const [created, setCreated] = useState<WorkspaceCreateProjectResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<WorkspaceCreateProjectRequest | null>(null);
  const defaultLocationRequest = useRef<Promise<WorkspaceProjectLocationGrant | null> | null>(null);
  const fallbackName = useMemo(
    () => `${t("onboarding.entry.create.defaultName")} ${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
    [t],
  );
  const projectName = editedName ?? suggestProjectName(prompt, fallbackName);
  const busy = submitting || choosingLocation;
  const locked = busy || created !== null;

  useEffect(() => {
    if (!onDefaultLocation) return undefined;
    defaultLocationRequest.current ??= onDefaultLocation();
    let cancelled = false;
    void defaultLocationRequest.current
      .then((grant) => { if (!cancelled && grant) setLocation((current) => current ?? grant); })
      // The usual place is a convenience; Change remains available.
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [onDefaultLocation]);

  const changed = () => {
    requestRef.current = null;
    setError(null);
  };

  const chooseLocation = async () => {
    if (!onChooseLocation || locked) return;
    setChoosingLocation(true);
    setError(null);
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
    const words = prompt.trim();
    const folder = projectName.trim();
    if (!words || !folder || !location || busy) return;
    setSubmitting(true);
    setError(null);
    try {
      requestRef.current ??= {
        name: folder,
        locationGrantId: location.grantId,
        operationId: crypto.randomUUID(),
        numberIfTaken: true,
        openInNewWindow,
        locale,
        source: BLANK,
      };
      const result = await onSubmit(requestRef.current);
      if (result.opening.status === "opened") {
        const opened = result.opening.result;
        const rootPath = opened.workspace?.path ?? opened.path ?? result.initialization.path;
        if (!openInNewWindow) {
          onStarted({ rootPath, runtimeId: agent.runtimeId, prompt: words });
        }
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

  let submitLabel = t("onboarding.agentStart.submit", { agent: name });
  if (submitting) submitLabel = t("onboarding.entry.create.submitting");
  else if (created) submitLabel = t("onboarding.entry.create.retryOpen");

  return (
    <DesktopDialogRoot onClose={busy ? undefined : onClose} dismissOnBackdrop={!busy} className="onboarding-entry-dialog-root">
      <form
        className="desktop-dialog-surface desktop-file-dialog onboarding-entry-dialog is-agent-start"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
      >
        <header className="desktop-dialog-header">
          <div className="desktop-dialog-title-row">
            <span className="desktop-dialog-leading onboarding-agent-start-leading" aria-hidden="true">
              <HomepageAgentBrandMark iconKey={agent.iconKey} label={agent.label} />
            </span>
            <h2>{title}</h2>
          </div>
          <Tooltip content={t("common.action.close")}>
            <DesktopDialogCloseButton label={t("common.action.close")} disabled={busy} onClick={onClose} />
          </Tooltip>
        </header>

        <div className="desktop-dialog-body desktop-file-dialog-body onboarding-entry-dialog-body">
          <label className="onboarding-agent-start-ask">
            <span className="onboarding-agent-start-avatar" aria-hidden="true">
              <HomepageAgentBrandMark iconKey={agent.iconKey} label={agent.label} />
            </span>
            <span className="onboarding-agent-start-ask-body">
              <span className="onboarding-agent-start-prompt-label">
                {t("onboarding.agentStart.promptLabel", { agent: name })}
              </span>
              <textarea
                className="onboarding-agent-start-input"
                value={prompt}
                rows={3}
                maxLength={2000}
                placeholder={t("onboarding.agentStart.promptPlaceholder")}
                disabled={locked}
                data-desktop-dialog-initial-focus="true"
                onChange={(event) => { setPrompt(event.target.value); changed(); }}
              />
            </span>
          </label>
          <div className="onboarding-entry-create-fields">
            <label className="onboarding-entry-create-field">
              <span className="onboarding-entry-create-label">{t("onboarding.entry.create.nameLabel")}</span>
              <input
                className="onboarding-entry-create-input"
                value={projectName}
                type="text"
                maxLength={120}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                disabled={locked}
                onChange={(event) => { setEditedName(event.target.value); changed(); }}
              />
            </label>
            <div className="onboarding-entry-create-field">
              <span className="onboarding-entry-create-label">{t("onboarding.entry.create.locationLabel")}</span>
              <button
                className="onboarding-entry-location-picker onboarding-entry-browse-button"
                type="button"
                disabled={locked || !onChooseLocation}
                aria-label={t("onboarding.entry.create.locationLabel")}
                onClick={() => void chooseLocation()}
              >
                <FolderIcon aria-hidden="true" />
                <bdi className={`onboarding-entry-location-path ${location ? "is-selected" : ""}`} dir="ltr" aria-live="polite">
                  {location?.path ?? t("onboarding.entry.create.locationPlaceholder")}
                </bdi>
                <span className="onboarding-entry-location-action">
                  {t(locationActionKey(choosingLocation, Boolean(location)))}
                </span>
              </button>
            </div>
          </div>
          <p className="onboarding-entry-dialog-note onboarding-agent-start-note">
            {t("onboarding.agentStart.note", { agent: name })}
          </p>
          {created && (
            <p className="onboarding-entry-dialog-note" role="status">
              {t("onboarding.entry.create.createdNote", { path: created.initialization.path })}
            </p>
          )}
          {error && <p className="desktop-dialog-error" role="alert">{error}</p>}
        </div>

        <footer className="desktop-dialog-footer">
          <button className="desktop-dialog-button" type="button" disabled={busy} onClick={onClose}>
            {t("common.action.cancel")}
          </button>
          <button
            className="desktop-dialog-button primary file onboarding-agent-start-submit"
            type="submit"
            disabled={busy || !prompt.trim() || !projectName.trim() || !location}
          >
            {!submitting && !created && <HomepageAgentBrandMark iconKey={agent.iconKey} label={agent.label} />}
            <span>{submitLabel}</span>
          </button>
        </footer>
      </form>
    </DesktopDialogRoot>
  );
}
