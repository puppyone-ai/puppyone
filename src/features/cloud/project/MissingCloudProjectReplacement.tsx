import { useEffect, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { getCloudRepositoryContext, type DesktopCloudSession } from "../../../lib/cloudApi";
import type { GitRemoteSummary, GitStatusSnapshot } from "../../../types/electron";
import { resolveCanonicalPuppyoneRemotes } from "../../source-control";
import { CloudPublishConfirmationDialog } from "../initialization/CloudPublishConfirmationDialog";
import { isTrustedCloudProjectLocator } from "../workspace/workspaceGitRemote";
import type { ProjectCloudContext } from "./context";

type MissingContext = Extract<ProjectCloudContext, { status: "not-found" }>;

/**
 * Whether this app can retire a folder's link to a Cloud project that no
 * longer exists: exactly one `puppyone` remote, naming that project, on this
 * app's Cloud. Anything else is left to Source Control.
 */
export function canReplaceMissingCloudProject(context: MissingContext, status: Pick<GitStatusSnapshot, "remotes"> | null,
  apiBaseUrl: string): boolean {
  const remote = resolveCanonicalPuppyoneRemotes(status);
  return remote.status === "unique" && remote.remote.name === "puppyone"
    && remote.info.projectId === context.projectId
    && remote.candidates.every(candidate => candidate.remote.name === "puppyone")
    && isTrustedCloudProjectLocator(remote.rawUrl, apiBaseUrl);
}

/**
 * Putting a folder in the Cloud again after its Cloud project disappeared.
 * The folder keeps working throughout; this only confirms retiring the old
 * link (native Detach) so the existing first publish can create a new Cloud
 * project. If the old project turns out to be reachable again, the link stays.
 */
export function MissingCloudProjectReplacement({ context, status, session, apiBaseUrl, onRemoveCloudRemote, onCancel, onDone }: {
  context: MissingContext;
  status: Pick<GitStatusSnapshot, "remotes"> | null;
  session: DesktopCloudSession;
  apiBaseUrl: string;
  onRemoveCloudRemote: (expectedRemotes: readonly GitRemoteSummary[]) => Promise<void>;
  onCancel: () => void;
  /** `reconnected`: the old Cloud project is reachable again. `replaced`: the old link is gone. */
  onDone: (outcome: "reconnected" | "replaced") => void;
}) {
  const { t } = useLocalization();
  // Native Detach compares the reviewed remote names and literal URLs while
  // holding the repository lock, so capture exactly what the user confirmed.
  const [reviewedRemotes] = useState<readonly GitRemoteSummary[]>(() => (status?.remotes ?? []).map(item => ({ ...item })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<symbol | null>(null);
  // The caller keys this dialog by folder, session and deployment. Retire
  // in-flight authorization when the user leaves that identity.
  useEffect(() => () => { request.current = null; }, []);

  const confirm = async () => {
    const remote = resolveCanonicalPuppyoneRemotes(status);
    if (request.current || remote.status !== "unique" || !context.projectId
      || !canReplaceMissingCloudProject(context, status, apiBaseUrl)) return;
    const token = Symbol("replace-missing-cloud-project");
    request.current = token;
    setBusy(true);
    setError(null);
    const target = remote.info.kind === "scope"
      ? { kind: "scope" as const, project_id: context.projectId, scope_id: remote.info.scopeId! }
      : { kind: "project_root" as const, project_id: context.projectId };
    try {
      try {
        await getCloudRepositoryContext(session, context.projectId, target, undefined, apiBaseUrl);
        if (request.current === token) onDone("reconnected");
        return;
      } catch (cause) {
        if (!(cause && typeof cause === "object" && "status" in cause && cause.status === 404)) throw cause;
      }
      if (request.current !== token) return;
      await onRemoveCloudRemote(reviewedRemotes);
      if (request.current === token) onDone("replaced");
    } catch {
      if (request.current === token) setError(t("cloud.activation.project.replaceFailed"));
    } finally {
      if (request.current === token) { request.current = null; setBusy(false); }
    }
  };

  return <CloudPublishConfirmationDialog
    title={t("cloud.activation.project.replaceTitle")}
    description={t("cloud.activation.project.replaceDescription")}
    confirmLabel={t("cloud.activation.project.replaceConfirm")}
    busy={busy} error={error}
    onCancel={onCancel} onConfirm={() => void confirm()} />;
}
