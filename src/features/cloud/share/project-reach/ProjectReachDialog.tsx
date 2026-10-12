import { bidiIsolate } from "@puppyone/localization";
import { useLocalization } from "@puppyone/localization/react";
import { Tooltip } from "@puppyone/shared-ui";
import { Check, Folder, FolderTree, LoaderCircle, Share2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../../app-shell/DesktopOverlayPortal";
import { getDesktopCloudWebUrl, type DesktopCloudSession } from "../../../../lib/cloudApi";
import { CloudAuthCard } from "../../auth/CloudAuthCard";
import { formatCloudMessage, formatCloudPublishFailure } from "../../cloudPresentation";
import { useCloudAuthController } from "../../hooks/useCloudAuthController";
import { CloudPublishProgressIndicator } from "../../initialization/CloudPublishProgressIndicator";
import { useCloudOrganizationData } from "../../organization/CloudOrganizationTeamPage";
import { workspaceResourceUrl } from "../../files/workspaceResourceUrl";
import { formatBytes, formatRelativeTime } from "../../utils";
import { ShareTargetMark } from "../CloudShareHome";
import {
  defaultReachScope,
  inviteReachTarget,
  isReachRunning,
  reachIntentForTarget,
  reachIntentTargets,
  reachModeSelectable,
  reachScopeForTarget,
  type ReachIntent,
  type ReachScope,
} from "./projectReach";
import { ReachHandoff } from "./ReachHandoff";
import { ReadersList } from "../ReadersList";
import { buildShareHandoff } from "../shareHandoff";
import { isActiveShare } from "../shareStatus";
import {
  getShareTarget,
  shareResidencyKey,
  shareTargetLabelKey,
  type ShareTarget,
  type ShareTargetId,
} from "../shareTargets";
import type { ShareWizardDialogProps, ShareWizardFolderEntry } from "../ShareWizardDialog";
import { shareHasReceipt } from "../useProjectShares";
import { useProjectReachFlow, type ProjectReachFlow, type ReachIssue } from "./useProjectReachFlow";
import { useProjectShareRevoke } from "../useProjectShareRevoke";
import { usePublishScope, type PublishScopeState } from "./usePublishScope";
import "../share.css";
import "./reach.css";

/**
 * One screen for the two things a person wants from a folder: let someone
 * read it, or put an agent to work on it.
 *
 * Both are the same shape — what it reaches, how much of it, what it may do,
 * one sentence about the consequence, one action — so the screen is one
 * skeleton and the intent only changes the verb, the object and that sentence.
 * Signing in is not a door in front of this screen; it appears as a step of
 * the progress list after the user has decided.
 */
export type ProjectReachDialogProps = ShareWizardDialogProps & {
  /**
   * Absolute path of the folder on this Mac. The screen states what a choice
   * would make reachable and prepares version history before an account
   * exists; both answers come from the folder itself.
   */
  workspacePath: string | null;
  /**
   * Which verb the caller asked for, when it asked by name. The Header's reach
   * control offers both, so it can open the connect side without preselecting
   * a destination; without it the target decides, as before.
   */
  initialIntent?: ReachIntent;
};

export function ProjectReachDialog(props: ProjectReachDialogProps) {
  const { t } = useLocalization();
  const [intent, setIntent] = useState<ReachIntent>(
    () => props.initialIntent ?? reachIntentForTarget(props.initialTargetId),
  );
  const [selectedId, setSelectedId] = useState<ShareTargetId | null>(props.initialTargetId);
  const [scope, setScope] = useState<ReachScope>(() => defaultReachScope(props.initialPath));
  const target = resolveReachTarget(intent, selectedId);
  const targetLabel = target ? t(shareTargetLabelKey(target.id)) : "";
  const effectiveScope = reachScopeForTarget(scope, target);
  const project = bidiIsolate(props.workspaceName);

  const { onIssued } = props;
  const handleIssued = useCallback((issue: ReachIssue, issuedTarget: ShareTarget) => {
    if (!issue.endpoint) return;
    onIssued({ targetId: issuedTarget.id, endpointId: issue.endpoint.id, issuedAt: issue.issuedAt });
  }, [onIssued]);

  const flow = useProjectReachFlow({
    workspacePath: props.workspacePath,
    session: props.session,
    apiBaseUrl: props.apiBaseUrl,
    projectContext: props.projectContext,
    publish: props.publish,
    shares: props.shares,
    target,
    targetLabel,
    scope: effectiveScope,
    onIssued: handleIssued,
    onSessionChange: props.onSessionChange,
  });
  const revoke = useProjectShareRevoke({
    session: props.session,
    apiBaseUrl: props.apiBaseUrl,
    shares: props.shares,
    onSessionChange: props.onSessionChange,
  });
  const title = t(
    intent === "invite" ? "cloud.share.reach.invite.title" : "cloud.share.reach.connect.title",
    { project },
  );
  // Who can reach the project is a fact about it, so it belongs on the screen
  // that changes it — but only once the account can actually see the answer.
  const readers = props.session && props.shares.loaded ? (
    <div className="desktop-reach-readers">
      <h3>{t("cloud.share.reach.readers.listLabel")}</h3>
      <ReadersList readers={props.shares.shares.filter(isActiveShare)} revoke={revoke} />
    </div>
  ) : null;

  return (
    <DesktopOverlayLayer>
      <DesktopDialogRoot className="desktop-share-dialog-backdrop" onClose={props.onClose}>
        <DesktopDialogSurface
          className="desktop-share-dialog desktop-reach-dialog"
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
            <Tooltip content={t("common.action.close")}><DesktopDialogCloseButton
              label={t("common.action.close")}
              onClick={props.onClose}
            /></Tooltip>
          </header>

          {flow.phase === "form" ? (
            <ReachForm
              intent={intent}
              target={target}
              targetLabel={targetLabel}
              scope={scope}
              dialog={props}
              readers={readers}
              onIntentChange={(next) => {
                setIntent(next);
                setSelectedId(next === "invite" ? "person" : null);
              }}
              onSelect={setSelectedId}
              onScopeChange={setScope}
              onConfirm={flow.start}
            />
          ) : (
            <ReachRun
              flow={flow}
              target={target}
              targetLabel={targetLabel}
              scope={effectiveScope}
              dialog={props}
              readers={readers}
            />
          )}
        </DesktopDialogSurface>
      </DesktopDialogRoot>
    </DesktopOverlayLayer>
  );
}

function resolveReachTarget(intent: ReachIntent, selectedId: ShareTargetId | null): ShareTarget | null {
  if (intent === "invite") return inviteReachTarget();
  return selectedId ? getShareTarget(selectedId) : null;
}

/**
 * The form itself: object, how much, what it may do, the consequence, one
 * action. Nothing here persuades and nothing here is a step.
 */
function ReachForm({
  intent,
  target,
  targetLabel,
  scope,
  dialog,
  readers,
  onIntentChange,
  onSelect,
  onScopeChange,
  onConfirm,
}: {
  intent: ReachIntent;
  target: ShareTarget | null;
  targetLabel: string;
  scope: ReachScope;
  dialog: ProjectReachDialogProps;
  readers: ReactNode;
  onIntentChange: (intent: ReachIntent) => void;
  onSelect: (id: ShareTargetId) => void;
  onScopeChange: (scope: ReachScope) => void;
  onConfirm: () => void;
}) {
  const { t } = useLocalization();
  const measured = usePublishScope({ rootPath: dialog.workspacePath, path: scope.path });

  return (
    <>
      <div className="desktop-dialog-body desktop-share-dialog-body desktop-reach-form">
        <button
          type="button"
          className="desktop-share-inline-link desktop-reach-switch"
          onClick={() => onIntentChange(intent === "invite" ? "connect" : "invite")}
        >
          {t(intent === "invite"
            ? "cloud.share.reach.switchToConnect"
            : "cloud.share.reach.switchToInvite")}
        </button>

        {intent === "invite" ? (
          <p className="desktop-reach-fact">{t("cloud.share.reach.invite.recipient")}</p>
        ) : (
          <ReachAgentChoice selected={target?.id ?? null} onSelect={onSelect} />
        )}

        <ReachScopeChoice
          scope={scope}
          measured={measured}
          initialPath={dialog.initialPath}
          listTopLevelFolders={dialog.listTopLevelFolders}
          onScopeChange={onScopeChange}
        />

        {reachModeSelectable(target) && (
          <div className="desktop-reach-section">
            <p className="desktop-share-question">{t("cloud.share.reach.mode.question")}</p>
            <div className="desktop-share-mode" role="radiogroup" aria-label={t("cloud.share.reach.mode.question")}>
              <ReachChoice
                checked={scope.mode === "r"}
                appearance="segment"
                label={t("cloud.share.scope.readOnly")}
                onSelect={() => onScopeChange({ path: scope.path, mode: "r" })}
              />
              <ReachChoice
                checked={scope.mode === "rw"}
                appearance="segment"
                label={t("cloud.share.scope.readWrite")}
                onSelect={() => onScopeChange({ path: scope.path, mode: "rw" })}
              />
            </div>
          </div>
        )}

        <p className="desktop-reach-mechanism">{t("cloud.share.reach.mechanism")}</p>
        {readers}
      </div>
      <footer className="desktop-dialog-footer two-action">
        <button type="button" className="desktop-dialog-button" onClick={dialog.onClose}>
          {t("cloud.common.cancel")}
        </button>
        <button
          type="button"
          className="desktop-dialog-button primary"
          data-desktop-dialog-initial-focus="true"
          disabled={!target}
          onClick={onConfirm}
        >
          {t(intent === "invite" ? "cloud.share.reach.action.invite" : "cloud.share.reach.action.connect",
            { target: targetLabel })}
        </button>
      </footer>
    </>
  );
}

/** The candidates, with whether each one is there without being asked. */
function ReachAgentChoice({
  selected,
  onSelect,
}: {
  selected: ShareTargetId | null;
  onSelect: (id: ShareTargetId) => void;
}) {
  const { t } = useLocalization();
  const question = t("cloud.share.reach.connect.question");
  return (
    <div className="desktop-reach-section">
      <p className="desktop-share-question">{question}</p>
      <div className="desktop-share-target-grid" role="radiogroup" aria-label={question}>
        {reachIntentTargets("connect").map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="radio"
            aria-checked={selected === candidate.id}
            className={`desktop-share-target${selected === candidate.id ? " is-selected" : ""}`}
            data-share-target={candidate.id}
            onClick={() => onSelect(candidate.id)}
          >
            <ShareTargetMark target={candidate} />
            <span className="desktop-share-target-label">{t(shareTargetLabelKey(candidate.id))}</span>
            <span className="desktop-reach-residency">{t(shareResidencyKey(candidate.residency))}</span>
          </button>
        ))}
      </div>
      {/* What connecting an agent means for the files, stated where the agent
          is chosen rather than as fine print next to the action. */}
      <p className="desktop-reach-fact">{t("cloud.share.reach.connect.changesReturn")}</p>
    </div>
  );
}

/** How much of the project, and what that choice actually amounts to. */
function ReachScopeChoice({
  scope,
  measured,
  initialPath,
  listTopLevelFolders,
  onScopeChange,
}: {
  scope: ReachScope;
  measured: PublishScopeState;
  initialPath: string;
  listTopLevelFolders: () => Promise<ShareWizardFolderEntry[]>;
  onScopeChange: (scope: ReachScope) => void;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const folders = useReachFolders(listTopLevelFolders, initialPath);
  const question = t("cloud.share.reach.scope.question");

  return (
    <div className="desktop-reach-section">
      <p className="desktop-share-question">{question}</p>
      <div className="desktop-reach-scope" role="radiogroup" aria-label={question}>
        {folders.entries.map((entry) => (
          <ReachChoice
            key={entry.path}
            checked={scope.path === entry.path}
            appearance="row"
            icon={entry.path === "" ? <FolderTree size={14} /> : <Folder size={14} />}
            label={entry.path === ""
              ? t("cloud.share.scope.whole")
              : <bdi>{t("cloud.share.scope.previewFolder", { folder: entry.name })}</bdi>}
            onSelect={() => onScopeChange({ path: entry.path, mode: scope.mode })}
          />
        ))}
        {folders.loading && (
          <span className="desktop-share-inline-status" role="status">
            <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
            <span>{t("cloud.share.scope.loading")}</span>
          </span>
        )}
      </div>
      <p className="desktop-reach-measured" aria-live="polite">
        {formatReachScopeMeasurement(measured, localization)}
      </p>
      {folders.failed && (
        <p className="desktop-reach-fact">{t("cloud.share.error.folderLoadFailed")}</p>
      )}
    </div>
  );
}

function formatReachScopeMeasurement(
  measured: PublishScopeState,
  localization: ReturnType<typeof useLocalization>,
): string {
  const { t } = localization;
  if (measured.failed) return t("cloud.share.reach.scope.measureFailed");
  if (!measured.scope) return t("cloud.share.reach.scope.measuring");
  const values = {
    count: measured.scope.files,
    size: formatBytes(measured.scope.bytes, localization),
  };
  if (measured.scope.truncated) return t("cloud.share.reach.scope.measuredAtLeast", values);
  return t("cloud.share.reach.scope.measured", values);
}

/**
 * The folder itself first, then the whole project, then its top-level folders.
 * The narrow choice leads because it is the default; widening is a decision.
 */
function useReachFolders(
  listTopLevelFolders: () => Promise<ShareWizardFolderEntry[]>,
  initialPath: string,
) {
  const [folders, setFolders] = useState<ShareWizardFolderEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listTopLevelFolders()
      .then((entries) => {
        if (!cancelled) setFolders(entries);
      })
      .catch(() => {
        if (cancelled) return;
        setFolders([]);
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [listTopLevelFolders]);

  const entries = useMemo(() => {
    const listed = (folders ?? []).filter((entry) => entry.path !== initialPath);
    const leading = initialPath
      ? [{ name: initialPath.split("/").filter(Boolean).pop() ?? initialPath, path: initialPath }]
      : [];
    return [...leading, { name: "", path: "" }, ...listed];
  }, [folders, initialPath]);

  return { entries, loading: folders === null, failed };
}

/**
 * A choice in the form. A row carries its own mark so the selected one is
 * legible without comparing backgrounds; a segment is read as a pair.
 */
function ReachChoice({
  checked,
  appearance,
  icon = null,
  label,
  onSelect,
}: {
  checked: boolean;
  appearance: "row" | "segment";
  icon?: ReactNode;
  label: ReactNode;
  onSelect: () => void;
}) {
  const row = appearance === "row";
  const base = row ? "desktop-share-scope-option" : "desktop-share-mode-option";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className={`${base}${checked ? " is-selected" : ""}`}
      onClick={onSelect}
    >
      {icon && <span className="desktop-share-scope-option-icon" aria-hidden="true">{icon}</span>}
      <span className={row ? "desktop-share-scope-option-label" : undefined}>{label}</span>
      {row && checked && <Check size={13} strokeWidth={2.2} aria-hidden="true" />}
    </button>
  );
}

/**
 * The same screen, stating what is happening. Signing in is step two of the
 * list; nothing exists in Cloud until it is done, so closing the dialog here
 * costs the user nothing but the wait.
 */
function ReachRun({
  flow,
  target,
  targetLabel,
  scope,
  dialog,
  readers,
}: {
  flow: ProjectReachFlow;
  target: ShareTarget | null;
  targetLabel: string;
  scope: ReachScope;
  dialog: ProjectReachDialogProps;
  readers: ReactNode;
}) {
  const { t } = useLocalization();

  return (
    <>
      <div className="desktop-dialog-body desktop-share-dialog-body desktop-reach-run">
        {isReachRunning(flow.phase) && (
          <ReachProgress flow={flow} targetLabel={targetLabel} dialog={dialog} />
        )}
        {flow.failure && (
          <div className="desktop-dialog-error" role="alert">
            {formatReachFailure(flow.failure, t)}
          </div>
        )}
        {flow.phase === "ready" && flow.issue && target && (
          <ReachResult
            issue={flow.issue}
            target={target}
            targetLabel={targetLabel}
            scope={scope}
            dialog={dialog}
          />
        )}
        {readers}
      </div>
      <footer className="desktop-dialog-footer two-action">
        <span className="desktop-share-footer-side">
          {flow.phase === "failed" && (
            <button type="button" className="desktop-dialog-button" onClick={flow.retry}>
              {t("cloud.share.action.retry")}
            </button>
          )}
        </span>
        <button
          type="button"
          className={`desktop-dialog-button${flow.phase === "ready" ? " primary" : ""}`}
          onClick={dialog.onClose}
        >
          {t("cloud.share.action.done")}
        </button>
      </footer>
    </>
  );
}

/** What is happening now, including the account as a step rather than a gate. */
function ReachProgress({
  flow,
  targetLabel,
  dialog,
}: {
  flow: ProjectReachFlow;
  targetLabel: string;
  dialog: ProjectReachDialogProps;
}) {
  const { t } = useLocalization();
  return (
    <>
      <CloudPublishProgressIndicator stage={flow.stage} account={flow.account} t={t} />
      <p className="desktop-reach-fact">{t("cloud.share.reach.progress.interrupt")}</p>
      {flow.phase === "account" && <ReachSignIn apiBaseUrl={dialog.apiBaseUrl} />}
      {flow.needsOrganization && dialog.session && (
        <ReachOrganizationChoice
          session={dialog.session}
          apiBaseUrl={dialog.apiBaseUrl}
          onSessionChange={dialog.onSessionChange}
          onResolve={flow.selectOrganization}
        />
      )}
      {flow.phase === "issuing" && (
        <span className="desktop-share-inline-status" role="status">
          <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
          <span>{t("cloud.share.publish.issuing", { target: targetLabel })}</span>
        </span>
      )}
    </>
  );
}

/**
 * The consequence: whether the other side has read anything yet, and the one
 * thing the user still has to carry over.
 */
function ReachResult({
  issue,
  target,
  targetLabel,
  scope,
  dialog,
}: {
  issue: ReachIssue;
  target: ShareTarget;
  targetLabel: string;
  scope: ReachScope;
  dialog: ProjectReachDialogProps;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const projectId = dialog.projectContext.status === "resolved" ? dialog.projectContext.projectId : null;
  const projectLink = useMemo(() => {
    if (!projectId) return null;
    try {
      return workspaceResourceUrl(getDesktopCloudWebUrl("/"), projectId, scope.path, true);
    } catch {
      return null;
    }
  }, [projectId, scope.path]);
  const handoff = buildShareHandoff({
    target,
    endpoint: issue.endpoint,
    apiBaseUrl: dialog.apiBaseUrl,
    projectLink,
  });
  const liveShare = issue.endpoint
    ? dialog.shares.shares.find((share) => share.id === issue.endpoint?.id) ?? null
    : null;
  const read = shareHasReceipt(liveShare, issue.issuedAt);
  const settled = target.channel === "link" || read;

  return (
    <>
      <div
        className={`desktop-share-receipt${settled ? " is-connected" : " is-waiting"}`}
        role="status"
        aria-live="polite"
      >
        <span className="desktop-share-receipt-dot" aria-hidden="true" />
        <span>
          <strong>{t(resolveReachReceiptKey(target, read), { target: targetLabel })}</strong>
          {liveShare?.lastSeenAt && (
            <small>{t("cloud.share.receipt.connectedAt", {
              time: formatRelativeTime(liveShare.lastSeenAt, localization),
            })}</small>
          )}
        </span>
      </div>
      {handoff ? (
        <ReachHandoff
          target={target}
          targetLabel={targetLabel}
          handoff={handoff}
          reused={issue.reused}
        />
      ) : (
        <div className="desktop-dialog-error" role="alert">{t("cloud.share.error.issueFailed")}</div>
      )}
    </>
  );
}

function resolveReachReceiptKey(target: ShareTarget, read: boolean): string {
  if (target?.channel === "link") return "cloud.share.receipt.linkReady";
  if (read) return "cloud.share.receipt.connected";
  return "cloud.share.receipt.waiting";
}

function formatReachFailure(
  failure: NonNullable<ProjectReachFlow["failure"]>,
  t: ReturnType<typeof useLocalization>["t"],
): string {
  if (failure.kind === "publish") return formatCloudPublishFailure(failure.failure, t);
  if (failure.kind === "blocked") {
    return failure.message
      ? formatCloudMessage(failure.message, t)
      : t("cloud.share.publish.unavailable");
  }
  if (failure.kind === "preparation") return t("cloud.share.reach.error.preparationFailed");
  return t("cloud.share.error.issueFailed");
}

function ReachSignIn({ apiBaseUrl }: { apiBaseUrl: string | null }) {
  const { t } = useLocalization();
  const auth = useCloudAuthController({ cloudApiBaseUrl: apiBaseUrl });
  return (
    <div className="desktop-share-sign-in">
      <p>{t("cloud.share.reach.account.why")}</p>
      <CloudAuthCard signingIn={auth.signingIn} error={auth.error} onSignIn={auth.startSignIn} />
    </div>
  );
}

/** Asked only when the account owns more than one organization. */
function ReachOrganizationChoice({
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
      <span className="desktop-share-inline-status" role="status">
        <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
        <span>{resolveOrganizationStatusLabel(status, t)}</span>
      </span>
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

function resolveOrganizationStatusLabel(
  status: string,
  t: ReturnType<typeof useLocalization>["t"],
): string {
  if (status === "none") return t("cloud.initialize.noOrganization");
  if (status === "error") return t("cloud.message.organization-load-failed");
  return t("cloud.share.publish.resolving");
}
