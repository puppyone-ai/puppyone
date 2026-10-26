import { bidiIsolate } from "@puppyone/localization";
import { useLocalization } from "@puppyone/localization/react";
import { Tooltip } from "@puppyone/shared-ui";
import { Check, Folder, FolderTree, Link2, LoaderCircle, Plug, Share2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../../../components/DesktopOverlayPortal";
import { getDesktopCloudWebUrl, type DesktopCloudSession } from "../../../../lib/cloudApi";
import { desktopPreferencesStore, selectReachLastAgentId, useDesktopPreference } from "../../../../preferencesStore";
import { CloudAuthCard } from "../../auth/CloudAuthCard";
import { formatCloudMessage, formatCloudPublishFailure } from "../../cloudPresentation";
import { useCloudAuthController } from "../../hooks/useCloudAuthController";
import { CloudPublishProgressIndicator } from "../../initialization/CloudPublishProgressIndicator";
import { useCloudOrganizationData } from "../../organization/CloudOrganizationTeamPage";
import { workspaceResourceUrl } from "../../files/workspaceResourceUrl";
import { formatRelativeTime } from "../../utils";
import { ShareTargetMark } from "../CloudShareHome";
import { CloudWorkspaceSharePreview, type SharePreviewEntry } from "../CloudWorkspaceSharePreview";
import type { CloudWorkspaceShareResource } from "../cloudWorkspaceShareResource";
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
import { ReachAgentChoice } from "./ReachAgentChoice";
import { ReachHandoff } from "./ReachHandoff";
import { ReadersList } from "../ReadersList";
import { buildShareHandoff, normalizeApiOrigin } from "../shareHandoff";
import { isActiveShare } from "../shareStatus";
import {
  getShareTarget,
  shareTargetLabelKey,
  type ShareTarget,
  type ShareTargetId,
} from "../shareTargets";
import type { ShareWizardDialogProps, ShareWizardFolderEntry } from "../ShareWizardDialog";
import { shareHasReceipt } from "../useProjectShares";
import { useProjectReachFlow, type ProjectReachFlow, type ReachIssue } from "./useProjectReachFlow";
import { useProjectShareRevoke } from "../useProjectShareRevoke";

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
  /**
   * What is inside the folder being shared, for the preview. Optional: without
   * it the preview falls back to the folders the scope chooser already loads,
   * so the screen degrades to a thinner preview instead of an empty frame.
   */
  listPreview?: (path: string) => Promise<ReachPreviewData>;
};

/**
 * What the preview renders: the entries of the folder, and one file to show
 * open beside them. Same shape the Cloud workspace share screen uses, because
 * it is the same illustration.
 */
export type ReachPreviewData = Readonly<{
  entries: readonly SharePreviewEntry[];
  file?: CloudWorkspaceShareResource["file"];
}>;

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
  // Which agent the user named is the one question this screen asks every
  // time. Remembering the answer is what lets the next one lead with it.
  const handleIssued = useCallback((issue: ReachIssue, issuedTarget: ShareTarget) => {
    if (!issue.endpoint) return;
    if (reachIntentForTarget(issuedTarget.id) === "connect") {
      desktopPreferencesStore.getState().setReachLastAgentId(issuedTarget.id);
    }
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
 * The form, in the order the user actually decides things.
 *
 * Inviting a person has no decision in it: the user already knows who they
 * are sending it to, and the project is the project. So the invite screen
 * states what the other side will get and offers the verb — narrowing it to
 * one folder is a rarity, and rarities belong behind a disclosure, not in
 * front of the action.
 *
 * Connecting an agent has exactly one decision first — which agent — and the
 * second only makes sense once it is answered, because "how much can it see"
 * is a question about a named agent. Asking both at once is what made the
 * screen read like a settings panel.
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
  const shared = { scope, dialog, readers, onIntentChange, onScopeChange, onConfirm };
  return intent === "invite"
    ? <ReachInviteForm {...shared} />
    : <ReachConnectForm {...shared} target={target} targetLabel={targetLabel} onSelect={onSelect} />;
}

type ReachFormShared = {
  scope: ReachScope;
  dialog: ProjectReachDialogProps;
  readers: ReactNode;
  onIntentChange: (intent: ReachIntent) => void;
  onScopeChange: (scope: ReachScope) => void;
  onConfirm: () => void;
};

/**
 * Inviting a person is making a link.
 *
 * "Invite a person" is a verb without an object: nobody can picture what
 * arrives at the other end. The link is that object, so it is the first thing
 * on the screen and it carries its own verb — the button that makes it sits
 * in the field it will fill, where the copy button will stand afterwards. A
 * button at the far corner of a dialog is not visibly connected to the empty
 * field at the top, and a user cannot act on a connection they cannot see.
 *
 * The empty field shows the real address with the unknown part masked, not a
 * blurred sentence: blur reads as a rendering fault, dots read as "not yet".
 */
function ReachInviteForm({
  scope, dialog, readers, onIntentChange, onConfirm,
}: ReachFormShared) {
  const { t } = useLocalization();
  return (
    <>
      <div className="desktop-dialog-body desktop-share-dialog-body desktop-reach-form">
        <ReachLinkRow action={t("cloud.share.reach.action.invite")} onCreate={onConfirm} />
        <p className="desktop-reach-fact">
          {t("cloud.share.reach.invite.linkPurpose")} {t("cloud.share.reach.mechanism")}
        </p>
        {/* What the link covers is what the user was looking at when they
            asked for it, and the preview shows exactly that. Offering to
            narrow it here turns a link into a configuration, which is the
            one thing this screen is not. */}
        <ReachPreview scope={scope} dialog={dialog} />
        {readers}
        <ReachSecondaryLinks intent="invite" onIntentChange={onIntentChange} />
      </div>
    </>
  );
}

/**
 * Connecting an agent: which one, what it may do, and the address that does
 * it.
 *
 * The screen reads as the request it is — this agent wants into this project
 * — and then asks the one thing the user has to decide before granting it:
 * whether it may change anything. How much of the project it sees has an
 * honest default, the whole of it, and narrowing is a rarity; a list of
 * folders in front of the verb made every connection look like a
 * configuration task.
 */
function ReachConnectForm({
  target, targetLabel, scope, dialog, readers, onIntentChange, onSelect, onScopeChange, onConfirm,
}: ReachFormShared & {
  target: ShareTarget | null;
  targetLabel: string;
  onSelect: (id: ShareTargetId) => void;
}) {
  const { t } = useLocalization();
  const [chosen, setChosen] = useState(() => target !== null);
  const [narrowing, setNarrowing] = useState(() => scope.path !== "");

  // Naming an agent is the whole screen. A link is a different way to hand
  // the project out, with different terms; offering it beside the names only
  // blurs what the user is choosing between.
  if (!chosen || !target) {
    return (
      <div className="desktop-dialog-body desktop-share-dialog-body desktop-reach-form">
        <ReachAgentChoice
          selected={target?.id ?? null}
          onSelect={(id) => { onSelect(id); setChosen(true); }}
        />
        {readers}
      </div>
    );
  }

  const folder = scope.path.split("/").filter(Boolean).pop() ?? "";
  return (
    <div className="desktop-dialog-body desktop-share-dialog-body desktop-reach-form">
      <div className="desktop-reach-chosen">
        <ShareTargetMark target={target} />
        <span className="desktop-reach-chosen-label" dir="auto">
          {folder
            ? t("cloud.share.reach.connect.consentFolder", { target: targetLabel, folder: bidiIsolate(folder) })
            : t("cloud.share.reach.connect.consent", { target: targetLabel })}
        </span>
        <button
          type="button"
          className="desktop-share-inline-link"
          onClick={() => setChosen(false)}
        >
          {t("cloud.share.reach.connect.change")}
        </button>
      </div>
      {reachModeSelectable(target) && (
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
      )}
      <ReachLinkRow
        action={t("cloud.share.reach.action.connect", { target: targetLabel })}
        kind={reachModeSelectable(target) ? "address" : "link"}
        apiBaseUrl={dialog.apiBaseUrl}
        onCreate={onConfirm}
      />
      <p className="desktop-reach-fact">{t("cloud.share.reach.connect.changesReturn")}</p>
      <ReachPreview scope={scope} dialog={dialog} />
      {narrowing && (
        <ReachScopeChoice
          scope={scope}
          question={t("cloud.share.reach.connect.scopeQuestion", { target: targetLabel })}
          initialPath={dialog.initialPath}
          listTopLevelFolders={dialog.listTopLevelFolders}
          onScopeChange={onScopeChange}
        />
      )}
      {readers}
      <ReachSecondaryLinks
        intent="connect"
        onIntentChange={onIntentChange}
        narrow={narrowing ? undefined : () => setNarrowing(true)}
      />
    </div>
  );
}

/**
 * A look inside the folder being shared — the product's own Explorer and
 * Viewer, reduced and inert, which is the illustration the Cloud workspace
 * share screen already uses. Sharing is about a thing the user recognizes on
 * sight; a count never was.
 *
 * Nothing annotates it. A file count and a size are facts about a folder, not
 * about the thing being handed over, and the illustration already answers the
 * only question the user has here.
 */
function ReachPreview({ scope, dialog }: {
  scope: ReachScope;
  dialog: ProjectReachDialogProps;
}) {
  const { t } = useLocalization();
  const preview = useReachPreview(dialog, scope.path);

  return (
    <section className="desktop-reach-preview" aria-label={t("cloud.share.reach.preview.label")}>
      <CloudWorkspaceSharePreview entries={preview.entries} file={preview.file} />
    </section>
  );
}

/**
 * The link, before it exists, with the verb that brings it into being.
 *
 * One row, one job: this is where the link lives, and this is how you get it.
 * The address is real and only the part that does not exist yet is masked, so
 * the row is a promise the product can keep rather than a decoration.
 */
function ReachLinkRow({ action, kind = "link", apiBaseUrl = null, onCreate }: {
  action: string;
  /** A person follows a link; an MCP agent is given an address of its own. */
  kind?: "link" | "address";
  apiBaseUrl?: string | null;
  onCreate?: () => void;
}) {
  const { t } = useLocalization();
  const address = kind === "address";
  return (
    <div
      className="desktop-reach-link-row"
      role="group"
      aria-label={t(address
        ? "cloud.share.reach.connect.addressPending"
        : "cloud.share.reach.invite.linkPending")}
    >
      <span className="desktop-reach-link-mark" aria-hidden="true">
        {address ? <Plug size={15} strokeWidth={1.8} /> : <Link2 size={15} strokeWidth={1.8} />}
      </span>
      <code className="desktop-reach-link-value" aria-hidden="true" dir="ltr">
        {address ? pendingAddressShape(apiBaseUrl) : pendingLinkShape()}
      </code>
      <button
        type="button"
        className="desktop-reach-link-action"
        data-desktop-dialog-initial-focus="true"
        onClick={onCreate}
      >
        {action}
      </button>
    </div>
  );
}

/**
 * The address the link will have, with the part that is not decided yet shown
 * as what it is: undecided. Nothing here is copyable, because there is
 * nothing to copy.
 */
function pendingLinkShape(): string {
  const masked = "•".repeat(10);
  try {
    return `${new URL(getDesktopCloudWebUrl("/")).host}/r/${masked}`;
  } catch {
    return `puppyone.ai/r/${masked}`;
  }
}

/**
 * The same promise for an agent: the address it will be given, with the key
 * that does not exist yet masked. The path is the real one, so what appears
 * when the key arrives is the row the user is already looking at.
 */
function pendingAddressShape(apiBaseUrl: string | null): string {
  const masked = "•".repeat(10);
  try {
    return `${new URL(normalizeApiOrigin(apiBaseUrl)).host}/api/v1/mcp/server/${masked}`;
  } catch {
    return `puppyone.ai/api/v1/mcp/server/${masked}`;
  }
}

/**
 * What to show inside the preview. The caller's own listing is preferred
 * because it can open a file; without it the scope chooser's folders are
 * still a truthful, if thinner, look inside.
 */
function useReachPreview(dialog: ProjectReachDialogProps, path: string): ReachPreviewData {
  const [preview, setPreview] = useState<ReachPreviewData>({ entries: [] });
  const { listPreview, listTopLevelFolders } = dialog;

  useEffect(() => {
    let cancelled = false;
    const load: Promise<ReachPreviewData> = listPreview
      ? listPreview(path)
      : listTopLevelFolders().then((folders) => (
        { entries: folders.map((folder) => ({ name: folder.name, type: "folder" })) }
      ));
    load
      .then((loaded) => { if (!cancelled) setPreview(loaded); })
      .catch(() => { if (!cancelled) setPreview({ entries: [] }); });
    return () => { cancelled = true; };
  }, [listPreview, listTopLevelFolders, path]);

  return preview;
}

/**
 * The other verb, and narrowing. Both are ways out of the screen's default,
 * so they sit together at the bottom as quiet links instead of competing
 * with the action or splitting the footer.
 */
function ReachSecondaryLinks({ intent, onIntentChange, narrow }: {
  intent: ReachIntent;
  onIntentChange: (intent: ReachIntent) => void;
  narrow?: () => void;
}) {
  const { t } = useLocalization();
  return (
    <div className="desktop-reach-links">
      {narrow && (
        <button type="button" className="desktop-share-inline-link" onClick={narrow}>
          {t("cloud.share.reach.scope.narrow")}
        </button>
      )}
      <button
        type="button"
        className="desktop-share-inline-link desktop-reach-switch"
        onClick={() => onIntentChange(intent === "invite" ? "connect" : "invite")}
      >
        {t(intent === "invite"
          ? "cloud.share.reach.switchToConnect"
          : "cloud.share.reach.switchToInvite")}
      </button>
    </div>
  );
}

/**
 * How much of the project. The measurement is not here: it belongs to the
 * object being shared, which is stated once at the top and updates with the
 * choice instead of repeating under it.
 */
function ReachScopeChoice({
  scope,
  question,
  initialPath,
  listTopLevelFolders,
  onScopeChange,
}: {
  scope: ReachScope;
  /** Named-agent screens ask about that agent; the invite screen does not. */
  question?: string;
  initialPath: string;
  listTopLevelFolders: () => Promise<ShareWizardFolderEntry[]>;
  onScopeChange: (scope: ReachScope) => void;
}) {
  const localization = useLocalization();
  const { t } = localization;
  const folders = useReachFolders(listTopLevelFolders, initialPath);
  const resolvedQuestion = question ?? t("cloud.share.reach.scope.question");

  return (
    <div className="desktop-reach-section">
      <p className="desktop-share-question">{resolvedQuestion}</p>
      <div className="desktop-reach-scope" role="radiogroup" aria-label={resolvedQuestion}>
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
      {folders.failed && (
        <p className="desktop-reach-fact">{t("cloud.share.error.folderLoadFailed")}</p>
      )}
    </div>
  );
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
