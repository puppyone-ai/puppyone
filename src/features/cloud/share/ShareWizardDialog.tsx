import { useLocalization } from "@puppyone/localization/react";
import { bidiIsolate } from "@puppyone/localization";
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Folder,
  FolderTree,
  LoaderCircle,
  Share2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../app-shell/DesktopOverlayPortal";
import {
  createCloudMcpEndpoint,
  createCloudScope,
  getDesktopCloudWebUrl,
  listCloudScopes,
  type DesktopCloudMcpEndpoint,
  type DesktopCloudSession,
} from "../../../lib/cloudApi";
import type { CloudPublishProgress } from "../../../types/electron";
import { CloudAuthCard } from "../auth/CloudAuthCard";
import {
  formatCloudMessage,
  formatCloudPublishFailure,
} from "../cloudPresentation";
import { useCloudAuthController } from "../hooks/useCloudAuthController";
import type { CloudInitializationFailure, CloudInitializationStartOptions } from "../initialization/useCloudInitialization";
import { CloudPublishProgressIndicator } from "../initialization/CloudPublishProgressIndicator";
import { useCloudOrganizationData } from "../organization/CloudOrganizationTeamPage";
import {
  getCloudContextWarning,
  type ProjectCloudContext,
} from "../project/context/projectCloudContext";
import { copyText, formatRelativeTime } from "../utils";
import { buildShareHandoff, maskApiKey, type ShareHandoff } from "./shareHandoff";
import {
  SHARE_TARGETS,
  getShareTarget,
  shareTargetHandoffStepKey,
  shareTargetLabelKey,
  shareTargetPreviewKey,
  type ShareTarget,
  type ShareTargetId,
} from "./shareTargets";
import { shareHasReceipt, type ProjectSharesState } from "./useProjectShares";
import "./share.css";

export type ShareWizardFolderEntry = Readonly<{ name: string; path: string }>;

export type ShareWizardPublishController = Readonly<{
  loading: boolean;
  progress: CloudPublishProgress | null;
  error: CloudInitializationFailure | null;
  start: (organizationId?: string, options?: CloudInitializationStartOptions) => void | Promise<void>;
}>;

export type ShareWizardDialogProps = {
  workspaceName: string;
  initialTargetId: ShareTargetId | null;
  /** Project-relative folder path; empty string shares the whole project. */
  initialPath: string;
  session: DesktopCloudSession | null;
  apiBaseUrl: string | null;
  projectContext: ProjectCloudContext;
  publish: ShareWizardPublishController;
  shares: ProjectSharesState;
  listTopLevelFolders: () => Promise<ShareWizardFolderEntry[]>;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  onWaitingChange: (waiting: boolean) => void;
  onOpenCloud: () => void;
  onClose: () => void;
};

type ShareStep = "target" | "scope" | "connect";

type ConnectPhase =
  | { kind: "sign-in" }
  | { kind: "organization" }
  | { kind: "publishing" }
  | { kind: "resolving" }
  | { kind: "issuing" }
  | { kind: "ready"; endpoint: DesktopCloudMcpEndpoint | null; issuedAt: string | null; reused: boolean }
  | { kind: "blocked"; message: string }
  | { kind: "failed" };

const CHAT_MENTIONS: Partial<Record<ShareTargetId, string>> = {
  "slack-bot": "@Claude",
  grok: "@Grok",
};

/**
 * One continuous task in one dialog: pick who → pick how much → make it
 * reachable (sign in / publish inline) → hand over something paste-ready →
 * stay open until the other side actually connects.
 */
export function ShareWizardDialog(props: ShareWizardDialogProps) {
  const { t } = useLocalization();
  const [targetId, setTargetId] = useState<ShareTargetId | null>(props.initialTargetId);
  const [step, setStep] = useState<ShareStep>(props.initialTargetId ? "scope" : "target");
  const [scope, setScope] = useState<ShareScope>({ path: props.initialPath, mode: "r" });
  const target = targetId ? getShareTarget(targetId) : null;
  const targetLabel = target ? t(shareTargetLabelKey(target.id)) : "";
  const title = target
    ? t("cloud.share.titleWithTarget", { project: bidiIsolate(props.workspaceName), target: targetLabel })
    : t("cloud.share.title", { project: bidiIsolate(props.workspaceName) });

  return (
    <DesktopOverlayLayer>
      <DesktopDialogRoot className="desktop-share-dialog-backdrop" onClose={props.onClose}>
        <DesktopDialogSurface
          className="desktop-share-dialog"
          width="min(600px, calc(100vw - 64px))"
          ariaLabel={title}
        >
          <header className="desktop-dialog-header desktop-share-dialog-header">
            <div className="desktop-dialog-title-row">
              <span className="desktop-share-dialog-leading" aria-hidden="true">
                <Share2 size={15} strokeWidth={1.9} />
              </span>
              <h2 dir="auto">{title}</h2>
            </div>
            <DesktopDialogCloseButton label={t("common.action.close")} onClick={props.onClose} />
          </header>

          <ShareStepper step={step} />

          {step === "target" && (
            <ShareTargetStep
              selected={targetId}
              onSelect={setTargetId}
              onNext={() => setStep("scope")}
            />
          )}
          {step === "scope" && target && (
            <ShareScopeStep
              target={target}
              targetLabel={targetLabel}
              workspaceName={props.workspaceName}
              initialScope={scope}
              listTopLevelFolders={props.listTopLevelFolders}
              canGoBack={props.initialTargetId === null}
              onBack={() => setStep("target")}
              onConfirm={(nextScope) => {
                setScope(nextScope);
                setStep("connect");
              }}
            />
          )}
          {step === "connect" && target && (
            <ShareConnectStep
              key={`${target.id}:${scope.path}:${scope.mode}`}
              {...props}
              target={target}
              targetLabel={targetLabel}
              scope={scope}
              onShareAnother={() => {
                setTargetId(null);
                setStep("target");
              }}
            />
          )}
        </DesktopDialogSurface>
      </DesktopDialogRoot>
    </DesktopOverlayLayer>
  );
}

type ShareScope = Readonly<{ path: string; mode: "r" | "rw" }>;

function ShareStepper({ step }: { step: ShareStep }) {
  const { t } = useLocalization();
  const steps: Array<{ id: ShareStep; label: string }> = [
    { id: "target", label: t("cloud.share.step.target") },
    { id: "scope", label: t("cloud.share.step.scope") },
    { id: "connect", label: t("cloud.share.step.handoff") },
  ];
  const activeIndex = steps.findIndex((entry) => entry.id === step);
  return (
    <ol className="desktop-share-stepper" aria-label={t("cloud.share.stepsLabel")}>
      {steps.map((entry, index) => (
        <li
          key={entry.id}
          className={index < activeIndex ? "done" : index === activeIndex ? "current" : undefined}
          aria-current={index === activeIndex ? "step" : undefined}
        >
          <span className="desktop-share-stepper-marker" aria-hidden="true">
            {index < activeIndex ? <Check size={11} strokeWidth={2.4} /> : index + 1}
          </span>
          <span>{entry.label}</span>
        </li>
      ))}
    </ol>
  );
}

function ShareTargetStep({
  selected,
  onSelect,
  onNext,
}: {
  selected: ShareTargetId | null;
  onSelect: (id: ShareTargetId) => void;
  onNext: () => void;
}) {
  const { t } = useLocalization();
  const selectedTarget = selected ? getShareTarget(selected) : null;
  return (
    <>
      <div className="desktop-dialog-body desktop-share-dialog-body">
        <p className="desktop-share-question">{t("cloud.share.target.question")}</p>
        <div className="desktop-share-target-grid" role="radiogroup" aria-label={t("cloud.share.target.question")}>
          {SHARE_TARGETS.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="radio"
              aria-checked={selected === candidate.id}
              className={`desktop-share-target${selected === candidate.id ? " is-selected" : ""}`}
              data-share-target={candidate.id}
              onClick={() => onSelect(candidate.id)}
              onDoubleClick={() => {
                onSelect(candidate.id);
                onNext();
              }}
            >
              <span className="desktop-share-target-mark" data-channel={candidate.channel} aria-hidden="true">
                {candidate.brand ? candidate.brand.slice(0, 1) : <Share2 size={14} />}
              </span>
              <span className="desktop-share-target-label">{t(shareTargetLabelKey(candidate.id))}</span>
            </button>
          ))}
        </div>
        <div className="desktop-share-preview" aria-live="polite">
          {selectedTarget
            ? t(shareTargetPreviewKey(selectedTarget.id))
            : t("cloud.share.target.pickHint")}
        </div>
      </div>
      <footer className="desktop-dialog-footer">
        <button
          type="button"
          className="desktop-dialog-button primary"
          disabled={!selected}
          onClick={onNext}
        >
          {t("cloud.share.action.next")}
        </button>
      </footer>
    </>
  );
}

function ShareScopeStep({
  target,
  targetLabel,
  workspaceName,
  initialScope,
  listTopLevelFolders,
  canGoBack,
  onBack,
  onConfirm,
}: {
  target: ShareTarget;
  targetLabel: string;
  workspaceName: string;
  initialScope: ShareScope;
  listTopLevelFolders: () => Promise<ShareWizardFolderEntry[]>;
  canGoBack: boolean;
  onBack: () => void;
  onConfirm: (scope: ShareScope) => void;
}) {
  const { t } = useLocalization();
  const initialPath = initialScope.path;
  const [path, setPath] = useState(initialPath);
  const [mode, setMode] = useState<"r" | "rw">(initialScope.mode);
  const [folders, setFolders] = useState<ShareWizardFolderEntry[] | null>(null);
  const [folderError, setFolderError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listTopLevelFolders()
      .then((entries) => {
        if (cancelled) return;
        setFolders(entries);
      })
      .catch(() => {
        if (cancelled) return;
        setFolders([]);
        setFolderError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [listTopLevelFolders]);

  const visibleFolders = useMemo(() => {
    if (!folders) return [];
    if (!initialPath || folders.some((entry) => entry.path === initialPath)) return folders;
    const name = initialPath.split("/").filter(Boolean).pop() ?? initialPath;
    return [{ name, path: initialPath }, ...folders];
  }, [folders, initialPath]);
  const selectedFolder = visibleFolders.find((entry) => entry.path === path) ?? null;
  const linkChannel = target.channel === "link";

  return (
    <>
      <div className="desktop-dialog-body desktop-share-dialog-body desktop-share-scope">
        <div className="desktop-share-scope-columns">
          <div className="desktop-share-scope-list" role="radiogroup" aria-label={t("cloud.share.scope.question")}>
            <p className="desktop-share-question">{t("cloud.share.scope.question")}</p>
            <ScopeOption
              checked={path === ""}
              icon={<FolderTree size={14} />}
              label={t("cloud.share.scope.whole")}
              onSelect={() => setPath("")}
            />
            {folders === null ? (
              <div className="desktop-share-scope-loading">
                <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
                <span>{t("cloud.share.scope.loading")}</span>
              </div>
            ) : visibleFolders.length === 0 ? (
              <p className="desktop-share-scope-empty">
                {folderError ? t("cloud.share.error.folderLoadFailed") : t("cloud.share.scope.empty")}
              </p>
            ) : (
              visibleFolders.map((entry) => (
                <ScopeOption
                  key={entry.path}
                  checked={path === entry.path}
                  icon={<Folder size={14} />}
                  label={<bdi>{entry.name}</bdi>}
                  onSelect={() => setPath(entry.path)}
                />
              ))
            )}
          </div>

          <aside className="desktop-share-scope-preview" aria-live="polite">
            <span className="desktop-share-scope-preview-label">
              {t("cloud.share.scope.previewTitle", { target: targetLabel })}
            </span>
            <strong dir="auto">
              {path === ""
                ? t("cloud.share.scope.previewWhole", { project: bidiIsolate(workspaceName) })
                : t("cloud.share.scope.previewFolder", { folder: bidiIsolate(selectedFolder?.name ?? path) })}
            </strong>
            <span className="desktop-share-scope-preview-mode">
              {t(linkChannel || mode === "r"
                ? "cloud.share.scope.previewMode.r"
                : "cloud.share.scope.previewMode.rw")}
            </span>
          </aside>
        </div>

        {!linkChannel && (
          <div className="desktop-share-mode" role="radiogroup" aria-label={t("cloud.share.scope.modeLabel")}>
            <ModeOption checked={mode === "r"} label={t("cloud.share.scope.readOnly")} onSelect={() => setMode("r")} />
            <ModeOption checked={mode === "rw"} label={t("cloud.share.scope.readWrite")} onSelect={() => setMode("rw")} />
          </div>
        )}
      </div>
      <footer className={`desktop-dialog-footer${canGoBack ? " two-action" : ""}`}>
        {canGoBack && (
          <button type="button" className="desktop-dialog-button" onClick={onBack}>
            {t("cloud.share.action.back")}
          </button>
        )}
        <button
          type="button"
          className="desktop-dialog-button primary"
          onClick={() => onConfirm({ path, mode: linkChannel ? "r" : mode })}
        >
          {t("cloud.share.action.connect", { target: targetLabel })}
        </button>
      </footer>
    </>
  );
}

function ScopeOption({
  checked,
  icon,
  label,
  onSelect,
}: {
  checked: boolean;
  icon: ReactNode;
  label: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className={`desktop-share-scope-option${checked ? " is-selected" : ""}`}
      onClick={onSelect}
    >
      <span className="desktop-share-scope-option-icon" aria-hidden="true">{icon}</span>
      <span className="desktop-share-scope-option-label">{label}</span>
      {checked && <Check size={13} strokeWidth={2.2} aria-hidden="true" />}
    </button>
  );
}

function ModeOption({
  checked,
  label,
  onSelect,
}: {
  checked: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className={`desktop-share-mode-option${checked ? " is-selected" : ""}`}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

function ShareConnectStep({
  target,
  targetLabel,
  scope,
  workspaceName,
  session,
  apiBaseUrl,
  projectContext,
  publish,
  shares,
  onSessionChange,
  onWaitingChange,
  onOpenCloud,
  onClose,
  onShareAnother,
}: ShareWizardDialogProps & {
  target: ShareTarget;
  targetLabel: string;
  scope: ShareScope;
  onShareAnother: () => void;
}) {
  const { t } = useLocalization();
  const [phase, setPhase] = useState<ConnectPhase>({ kind: "resolving" });
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [issueToken, setIssueToken] = useState(0);
  const publishRequestedRef = useRef(false);
  const forceCreateRef = useRef(false);
  const latest = useRef({ session, apiBaseUrl, shares, onSessionChange, publish, projectContext, t });
  latest.current = { session, apiBaseUrl, shares, onSessionChange, publish, projectContext, t };
  const projectId = projectContext.status === "resolved" ? projectContext.projectId : null;
  const hasSession = Boolean(session);
  const publishFailed = Boolean(publish.error);
  const publishLoading = publish.loading;
  const sharesLoaded = shares.loaded || shares.error;
  const settled = phase.kind === "ready" || phase.kind === "failed";

  const transition = useCallback((next: ConnectPhase) => {
    setPhase((previous) => (
      previous.kind === next.kind && next.kind !== "ready" && next.kind !== "blocked" ? previous : next
    ));
  }, []);
  const beginIssue = useCallback((forceCreate: boolean) => {
    forceCreateRef.current = forceCreate;
    setPhase({ kind: "issuing" });
    setIssueToken((token) => token + 1);
  }, []);

  // Orchestration: derive the current phase from session, Cloud context, and
  // publish state. Only state that changes phase is in the dependency list.
  useEffect(() => {
    if (settled || phase.kind === "issuing") return;
    if (!hasSession) {
      transition({ kind: "sign-in" });
      return;
    }
    if (publishFailed && publishRequestedRef.current) {
      transition({ kind: "failed" });
      return;
    }
    const context = latest.current.projectContext;
    if (context.status === "resolved") {
      if (target.channel === "mcp" && !sharesLoaded) {
        transition({ kind: "resolving" });
        return;
      }
      beginIssue(false);
      return;
    }
    if (context.status === "resolving") {
      transition({ kind: "resolving" });
      return;
    }
    if (context.status === "local-only") {
      if (publishLoading || publishRequestedRef.current) {
        transition({ kind: "publishing" });
        return;
      }
      if (!organizationId) {
        transition({ kind: "organization" });
        return;
      }
      publishRequestedRef.current = true;
      transition({ kind: "publishing" });
      void latest.current.publish.start(organizationId, { navigateToCloud: false });
      return;
    }
    const warning = getCloudContextWarning(context);
    transition({
      kind: "blocked",
      message: warning
        ? formatCloudMessage(warning, latest.current.t)
        : latest.current.t("cloud.share.publish.unavailable"),
    });
  }, [
    beginIssue,
    hasSession,
    organizationId,
    phase.kind,
    projectContext.status,
    publishFailed,
    publishLoading,
    settled,
    sharesLoaded,
    target.channel,
    transition,
  ]);

  // Issue (or reuse) the destination's access exactly once per request.
  useEffect(() => {
    if (issueToken === 0) return undefined;
    const { session: currentSession, apiBaseUrl: base, shares: currentShares, onSessionChange: sessionHandler } = latest.current;
    const currentProjectId = projectId;
    if (!currentSession || !currentProjectId) return undefined;
    let cancelled = false;
    const finish = (next: ConnectPhase) => {
      if (!cancelled) setPhase(next);
    };
    const run = async () => {
      if (target.channel === "link") {
        finish({ kind: "ready", endpoint: null, issuedAt: new Date().toISOString(), reused: false });
        return;
      }
      if (!forceCreateRef.current) {
        const existing = currentShares.shares.find((share) => (
          share.path === scope.path
          && share.readonly === (scope.mode === "r")
          && share.status !== "disabled"
        ));
        if (existing) {
          finish({ kind: "ready", endpoint: existing.endpoint, issuedAt: existing.createdAt, reused: true });
          return;
        }
      }
      forceCreateRef.current = false;
      try {
        if (scope.path) {
          const scopes = await listCloudScopes(currentSession, currentProjectId, sessionHandler, base);
          if (cancelled) return;
          if (!scopes.some((candidate) => candidate.path === scope.path)) {
            await createCloudScope(
              currentSession,
              currentProjectId,
              {
                name: scope.path.split("/").filter(Boolean).pop() ?? scope.path,
                path: scope.path,
                max_mode: scope.mode,
                exclude: [],
              },
              sessionHandler,
              base,
            );
            if (cancelled) return;
          }
        }
        const endpoint = await createCloudMcpEndpoint(
          currentSession,
          {
            project_id: currentProjectId,
            path: scope.path,
            name: targetLabel,
            accesses: [{ path: scope.path, json_path: "", readonly: scope.mode === "r" }],
          },
          sessionHandler,
          base,
        );
        if (cancelled) return;
        finish({ kind: "ready", endpoint, issuedAt: new Date().toISOString(), reused: false });
        void latest.current.shares.reload();
      } catch {
        finish({ kind: "failed" });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [issueToken, projectId, scope, target.channel, targetLabel]);

  const ready = phase.kind === "ready" ? phase : null;
  const liveShare = ready?.endpoint
    ? shares.shares.find((share) => share.id === ready.endpoint?.id) ?? null
    : null;
  const connected = Boolean(ready && target.channel === "mcp" && shareHasReceipt(liveShare, ready.issuedAt));
  const waiting = Boolean(ready && target.channel === "mcp" && !connected);
  useEffect(() => {
    onWaitingChange(waiting);
    return () => onWaitingChange(false);
  }, [onWaitingChange, waiting]);

  const projectLink = useMemo(() => {
    if (!projectId) return null;
    try {
      return getDesktopCloudWebUrl(`/projects/${projectId}`);
    } catch {
      return null;
    }
  }, [projectId]);
  const handoff = ready
    ? buildShareHandoff({ target, endpoint: ready.endpoint, apiBaseUrl, projectLink })
    : null;

  const retry = useCallback(() => {
    publishRequestedRef.current = false;
    setPhase({ kind: "resolving" });
  }, []);

  return (
    <>
      <div className="desktop-dialog-body desktop-share-dialog-body desktop-share-connect">
        {phase.kind === "sign-in" && (
          <ShareSignIn apiBaseUrl={apiBaseUrl} targetLabel={targetLabel} />
        )}
        {phase.kind === "organization" && session && (
          <ShareOrganizationPicker
            session={session}
            apiBaseUrl={apiBaseUrl}
            onSessionChange={onSessionChange}
            onResolve={setOrganizationId}
          />
        )}
        {phase.kind === "publishing" && (
          <div className="desktop-share-publish">
            <h3 dir="auto">{t("cloud.share.publish.title", { project: bidiIsolate(workspaceName), target: targetLabel })}</h3>
            <p>{t("cloud.share.publish.why", { target: targetLabel })}</p>
            {publish.progress
              ? <CloudPublishProgressIndicator stage={publish.progress.stage} t={t} />
              : (
                <div className="desktop-share-inline-status" role="status">
                  <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
                  <span>{t("cloud.share.publish.resolving")}</span>
                </div>
              )}
          </div>
        )}
        {phase.kind === "resolving" && (
          <div className="desktop-share-inline-status" role="status">
            <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
            <span>{t("cloud.share.publish.resolving")}</span>
          </div>
        )}
        {phase.kind === "issuing" && (
          <div className="desktop-share-inline-status" role="status">
            <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
            <span>{t("cloud.share.publish.issuing", { target: targetLabel })}</span>
          </div>
        )}
        {phase.kind === "blocked" && (
          <div className="desktop-dialog-error" role="alert">{phase.message}</div>
        )}
        {phase.kind === "failed" && (
          <div className="desktop-dialog-error" role="alert">
            {publish.error ? formatCloudPublishFailure(publish.error, t) : t("cloud.share.error.issueFailed")}
          </div>
        )}
        {ready && handoff && (
          <ShareHandoffPanel
            target={target}
            targetLabel={targetLabel}
            handoff={handoff}
            reused={ready.reused}
            onIssueNewKey={() => beginIssue(true)}
          />
        )}
        {ready && !handoff && (
          <div className="desktop-dialog-error" role="alert">{t("cloud.share.error.issueFailed")}</div>
        )}
        {ready && (
          <ShareReceipt
            channel={target.channel}
            targetLabel={targetLabel}
            connected={connected}
            lastSeenAt={liveShare?.lastSeenAt ?? null}
          />
        )}
      </div>
      <footer className="desktop-dialog-footer two-action">
        <span className="desktop-share-footer-side">
          {phase.kind === "blocked" && (
            <button type="button" className="desktop-dialog-button" onClick={onOpenCloud}>
              {t("cloud.share.action.openCloud")}
            </button>
          )}
          {phase.kind === "failed" && (
            <button type="button" className="desktop-dialog-button" onClick={retry}>
              {t("cloud.share.action.retry")}
            </button>
          )}
          {ready && (
            <button type="button" className="desktop-dialog-button" onClick={onShareAnother}>
              {t("cloud.share.action.shareAnother")}
            </button>
          )}
        </span>
        <button
          type="button"
          className={`desktop-dialog-button${connected || target.channel === "link" ? " primary" : ""}`}
          onClick={onClose}
        >
          {t("cloud.share.action.done")}
        </button>
      </footer>
    </>
  );
}

function ShareSignIn({ apiBaseUrl, targetLabel }: { apiBaseUrl: string | null; targetLabel: string }) {
  const { t } = useLocalization();
  const auth = useCloudAuthController({ cloudApiBaseUrl: apiBaseUrl });
  return (
    <div className="desktop-share-sign-in">
      <p>{t("cloud.share.publish.signIn", { target: targetLabel })}</p>
      <CloudAuthCard signingIn={auth.signingIn} error={auth.error} onSignIn={auth.startSignIn} />
    </div>
  );
}

function ShareOrganizationPicker({
  session,
  apiBaseUrl,
  onSessionChange,
  onResolve,
}: {
  session: DesktopCloudSession;
  apiBaseUrl: string | null;
  onSessionChange: (session: DesktopCloudSession | null) => void;
  onResolve: (organizationId: string) => void;
}) {
  const { t } = useLocalization();
  const organizationData = useCloudOrganizationData(session, apiBaseUrl, onSessionChange, {
    loadTeamDetails: false,
    selectionPolicy: "remembered",
  });
  const { organizations, selectedOrganizationId, status } = organizationData;
  useEffect(() => {
    if (selectedOrganizationId) {
      onResolve(selectedOrganizationId);
      return;
    }
    if (organizations.length === 1) onResolve(organizations[0].id);
  }, [onResolve, organizations, selectedOrganizationId]);

  if (status === "loading" || organizations.length <= 1) {
    return (
      <div className="desktop-share-inline-status" role="status">
        <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
        <span>{status === "none"
          ? t("cloud.initialize.noOrganization")
          : status === "error"
            ? t("cloud.message.organization-load-failed")
            : t("cloud.share.publish.resolving")}</span>
      </div>
    );
  }
  return (
    <label className="desktop-share-organization">
      <span>{t("cloud.share.publish.organization")}</span>
      <select
        aria-label={t("cloud.share.publish.organization")}
        value={selectedOrganizationId ?? ""}
        onChange={(event) => {
          organizationData.selectOrganization(event.target.value);
          onResolve(event.target.value);
        }}
      >
        <option value="" disabled>{t("cloud.organization.selectPlaceholder")}</option>
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.id}>{organization.name}</option>
        ))}
      </select>
    </label>
  );
}

function ShareHandoffPanel({
  target,
  targetLabel,
  handoff,
  reused,
  onIssueNewKey,
}: {
  target: ShareTarget;
  targetLabel: string;
  handoff: ShareHandoff;
  reused: boolean;
  onIssueNewKey: () => void;
}) {
  const { t } = useLocalization();
  const [keyVisible, setKeyVisible] = useState(false);
  const steps = Array.from({ length: target.handoffSteps }, (_, index) => (
    t(shareTargetHandoffStepKey(target.id, index + 1))
  ));
  const mention = CHAT_MENTIONS[target.id];

  return (
    <section className="desktop-share-handoff" aria-label={t("cloud.share.handoff.title", { target: targetLabel })}>
      <div className="desktop-share-handoff-steps">
        <h3>{target.brand
          ? t("cloud.share.handoff.title", { target: targetLabel })
          : t("cloud.share.handoff.titleGeneric")}</h3>
        <ol>
          {steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
        {target.docsUrl && (
          <a
            className="desktop-share-handoff-docs"
            href={target.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={12} aria-hidden="true" />
            <span>{t("cloud.share.handoff.docs", { target: targetLabel })}</span>
          </a>
        )}
      </div>

      {handoff.channel === "mcp" ? (
        <div className="desktop-share-handoff-fields">
          <CopyField
            label={t("cloud.share.handoff.serverUrl")}
            value={handoff.serverUrl}
            display={handoff.serverUrl || t("cloud.access.connectionPreparing")}
            disabled={!handoff.serverUrl}
          />
          <CopyField
            label={t("cloud.share.handoff.apiKey")}
            value={handoff.apiKey ?? ""}
            display={keyVisible && handoff.apiKey ? handoff.apiKey : maskApiKey(handoff.apiKey, handoff.apiKeyHint)}
            disabled={!handoff.apiKey}
            trailing={handoff.apiKey ? (
              <button
                type="button"
                className="desktop-share-copy-toggle"
                aria-pressed={keyVisible}
                aria-label={t(keyVisible ? "cloud.share.action.hideKey" : "cloud.share.action.showKey")}
                onClick={() => setKeyVisible((visible) => !visible)}
              >
                {keyVisible ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            ) : null}
          />
          {reused && !handoff.apiKey && (
            <p className="desktop-share-handoff-note">
              {t("cloud.share.handoff.apiKeyReused")}
              {" "}
              <button type="button" className="desktop-share-inline-link" onClick={onIssueNewKey}>
                {t("cloud.share.action.issueNewKey")}
              </button>
            </p>
          )}
        </div>
      ) : (
        <div className="desktop-share-handoff-fields">
          <CopyField label={t("cloud.share.handoff.link")} value={handoff.url} display={handoff.url} />
          {mention && (
            <CopyField
              label={t("cloud.share.handoff.prompt")}
              value={t("cloud.share.handoff.promptTemplate", { mention, url: handoff.url })}
              display={t("cloud.share.handoff.promptTemplate", { mention, url: handoff.url })}
              multiline
            />
          )}
          <p className="desktop-share-handoff-note">{t("cloud.share.handoff.linkNote")}</p>
        </div>
      )}
    </section>
  );
}

function CopyField({
  label,
  value,
  display,
  disabled = false,
  multiline = false,
  trailing = null,
}: {
  label: string;
  value: string;
  display: string;
  disabled?: boolean;
  multiline?: boolean;
  trailing?: ReactNode;
}) {
  const { t } = useLocalization();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className={`desktop-share-copy-field${multiline ? " is-multiline" : ""}`}>
      <span className="desktop-share-copy-label">{label}</span>
      <code className="desktop-share-copy-value" dir="ltr">{display}</code>
      <span className="desktop-share-copy-actions">
        {trailing}
        <button
          type="button"
          className={`desktop-share-copy-button${copied ? " is-copied" : ""}`}
          disabled={disabled || !value}
          aria-label={t("cloud.share.action.copyLabel", { label })}
          onClick={() => {
            void copyText(value).then(() => setCopied(true)).catch(() => {});
          }}
        >
          {copied ? <Check size={13} strokeWidth={2.2} /> : <Copy size={13} />}
          <span>{t(copied ? "cloud.share.action.copied" : "cloud.share.action.copy")}</span>
        </button>
      </span>
    </div>
  );
}

function ShareReceipt({
  channel,
  targetLabel,
  connected,
  lastSeenAt,
}: {
  channel: ShareTarget["channel"];
  targetLabel: string;
  connected: boolean;
  lastSeenAt: string | null;
}) {
  const localization = useLocalization();
  const { t } = localization;
  if (channel === "link") {
    return (
      <div className="desktop-share-receipt is-ready" role="status">
        <span className="desktop-share-receipt-dot" aria-hidden="true" />
        <span>{t("cloud.share.receipt.linkReady", { target: targetLabel })}</span>
      </div>
    );
  }
  if (connected) {
    return (
      <div className="desktop-share-receipt is-connected" role="status" aria-live="polite">
        <span className="desktop-share-receipt-dot" aria-hidden="true" />
        <span>
          <strong>{t("cloud.share.receipt.connected", { target: targetLabel })}</strong>
          {lastSeenAt && (
            <small>{t("cloud.share.receipt.connectedAt", { time: formatRelativeTime(lastSeenAt, localization) })}</small>
          )}
        </span>
      </div>
    );
  }
  return (
    <div className="desktop-share-receipt is-waiting" role="status" aria-live="polite">
      <span className="desktop-share-receipt-dot" aria-hidden="true" />
      <span>
        <strong>{t("cloud.share.receipt.waiting", { target: targetLabel })}</strong>
        <small>{t("cloud.share.receipt.waitingHint", { target: targetLabel })}</small>
      </span>
    </div>
  );
}
