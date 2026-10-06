import { useEffect, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { getCloudRepositoryContext, type DesktopCloudSession } from "../../../lib/cloudApi";
import type { GitRemoteSummary, GitStatusSnapshot } from "../../../types/electron";
import { resolveCanonicalPuppyoneRemotes } from "../../source-control/remotes";
import { CloudProjectActivation } from "../components/CloudProjectActivation";
import { CloudPublishConfirmationDialog } from "../initialization/CloudPublishConfirmationDialog";
import { isTrustedCloudProjectLocator } from "../workspace/workspaceGitRemote";
import type { ProjectCloudContext } from "../project/context";

/** A missing association remains an association until the user reviews its
 * replacement. Reuse native Detach and the existing first-push owner. */
export function MissingCloudProjectRecovery({ context, status, session, apiBaseUrl, onRetry, onRemoveCloudRemote }: {
  context: Extract<ProjectCloudContext, { status: "not-found" }>;
  status: Pick<GitStatusSnapshot, "remotes"> | null;
  session: DesktopCloudSession;
  apiBaseUrl: string;
  onRetry: () => void;
  onRemoveCloudRemote: (expectedRemotes: readonly GitRemoteSummary[]) => Promise<void>;
}) {
  const { t } = useLocalization();
  const remote = resolveCanonicalPuppyoneRemotes(status);
  const replaceable = remote.status === "unique" && remote.remote.name === "puppyone"
    && remote.info.projectId === context.projectId
    && remote.candidates.every(candidate => candidate.remote.name === "puppyone")
    && isTrustedCloudProjectLocator(remote.rawUrl, apiBaseUrl);
  const [reviewedRemotes, setReviewedRemotes] = useState<readonly GitRemoteSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<symbol | null>(null);
  // The caller keys this surface by repository, session and deployment. Retire
  // in-flight authorization when the user leaves that identity.
  useEffect(() => () => { request.current = null; }, []);

  const confirm = async () => {
    if (!replaceable || remote.status !== "unique" || !context.projectId || !reviewedRemotes || request.current) return;
    const token = Symbol("replace-missing-cloud-association");
    request.current = token;
    setBusy(true);
    setError(null);
    const target = remote.info.kind === "scope"
      ? { kind: "scope" as const, project_id: context.projectId, scope_id: remote.info.scopeId! }
      : { kind: "project_root" as const, project_id: context.projectId };
    try {
      try {
        await getCloudRepositoryContext(session, context.projectId, target, undefined, apiBaseUrl);
        // The old target became accessible again. Keep its remote and reopen it.
        if (request.current === token) { setReviewedRemotes(null); onRetry(); }
        return;
      } catch (cause) {
        if (!(cause && typeof cause === "object" && "status" in cause && cause.status === 404)) throw cause;
      }
      if (request.current !== token) return;
      // Native Detach compares all reviewed remote names and literal URLs while
      // holding the repository lock, before touching credentials or Git config.
      await onRemoveCloudRemote(reviewedRemotes);
      if (request.current === token) { setReviewedRemotes(null); onRetry(); }
    } catch {
      if (request.current === token) setError(t("cloud.activation.project.replaceFailed"));
    } finally {
      if (request.current === token) { request.current = null; setBusy(false); }
    }
  };

  return <>
    <CloudProjectActivation
      action={<button type="button" className="desktop-dialog-button primary" data-desktop-dialog-initial-focus="true"
        aria-haspopup={replaceable ? "dialog" : undefined} data-cloud-replace-action={replaceable || undefined}
        onClick={() => {
          if (replaceable && status) { setError(null); setReviewedRemotes(status.remotes.map(item => ({ ...item }))); }
          else onRetry();
        }}>
        {replaceable ? t("cloud.activation.project.publish") : t("cloud.common.retry")}
      </button>} />
    {reviewedRemotes && <CloudPublishConfirmationDialog
      title={t("cloud.activation.project.replaceTitle")}
      description={t("cloud.activation.project.replaceDescription")}
      confirmLabel={t("cloud.activation.project.replaceConfirm")}
      busy={busy} error={error}
      onCancel={() => setReviewedRemotes(null)} onConfirm={() => void confirm()} />}
  </>;
}
