import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization } from "@puppyone/localization";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../../components/DesktopDialog";
import { DesktopOverlayLayer } from "../../../components/DesktopOverlayPortal";
import type { GitRemoteSummary, GitStatusSnapshot, GitSyncTargetSummary } from "../../../types/electron";
import { resolveCanonicalPuppyoneRemotes } from "../../source-control";

const CLOUD_REMOTE = "puppyone";

/** The part of a folder's Git status that ending its Cloud link reads. */
export type CloudLinkStatus = Pick<GitStatusSnapshot, "remotes"> & {
  sourceControl?: { remote?: { target?: Pick<GitSyncTargetSummary, "remote" | "exists" | "ahead"> | null } };
};

/**
 * Whether this app can end a folder's Cloud link by itself: exactly one Cloud
 * connection, named the way this app names it. It need not be on this app's
 * Cloud — a link to another environment is ended the same way. Anything more
 * tangled is left to Source Control.
 */
export function canDisconnectCloudLink(status: Pick<GitStatusSnapshot, "remotes"> | null): boolean {
  const remote = resolveCanonicalPuppyoneRemotes(status);
  return remote.status === "unique" && remote.remote.name === CLOUD_REMOTE
    && remote.candidates.every((candidate) => candidate.remote.name === CLOUD_REMOTE);
}

/** Commits made here that the linked Cloud project has not received. */
export function unsentCloudCommits(status: CloudLinkStatus | null): number {
  const target = status?.sourceControl?.remote?.target;
  return target?.remote === CLOUD_REMOTE && target.exists ? Math.max(0, target.ahead) : 0;
}

/**
 * Ending a folder's link to its Cloud project. Only the folder's Git
 * connection goes; the Cloud project and the files here stay. Afterwards the
 * folder is an ordinary local project that can be put in the Cloud again.
 */
export function CloudLinkDisconnectDialog({ projectName, status, onDisconnect, onCancel, onDone }: {
  projectName: string | null;
  status: CloudLinkStatus | null;
  /** Native Detach; it refuses when the remotes differ from the reviewed ones. */
  onDisconnect: (expectedRemotes: readonly GitRemoteSummary[]) => Promise<void>;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { t } = useLocalization();
  // Native Detach compares the reviewed remote names and literal URLs while
  // holding the repository lock, so capture exactly what the user confirmed.
  const [reviewed] = useState(() => ({
    remotes: (status?.remotes ?? []).map((item) => ({ ...item })) as readonly GitRemoteSummary[],
    unsent: unsentCloudCommits(status),
  }));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<symbol | null>(null);
  // The caller keys this dialog by folder; leaving it retires the request.
  useEffect(() => () => { request.current = null; }, []);

  const confirm = async () => {
    if (request.current) return;
    const token = Symbol("disconnect-cloud-link");
    request.current = token;
    setPending(true);
    setError(null);
    try {
      await onDisconnect(reviewed.remotes);
      if (request.current === token) onDone();
    } catch {
      if (request.current === token) setError(t("cloud.disconnect.failed"));
    } finally {
      if (request.current === token) { request.current = null; setPending(false); }
    }
  };

  const title = t("cloud.disconnect.title");
  return (
    <DesktopOverlayLayer>
      <DesktopDialogRoot dismissOnBackdrop={!pending} onClose={pending ? undefined : onCancel}>
        <DesktopDialogSurface className="desktop-cloud-disconnect-dialog" width={420} ariaLabel={title}>
          <header className="desktop-dialog-header">
            <div className="desktop-dialog-title-row"><h2>{title}</h2></div>
            <Tooltip content={t("common.action.close")}><DesktopDialogCloseButton
              label={t("common.action.close")} disabled={pending} onClick={onCancel} /></Tooltip>
          </header>
          <div className="desktop-dialog-body">
            <p>
              {projectName
                ? t("cloud.disconnect.description", { project: bidiIsolate(projectName) })
                : t("cloud.disconnect.descriptionUnnamed")}
              {reviewed.unsent > 0 && <> {t("cloud.disconnect.unsent", { count: reviewed.unsent })}</>}
            </p>
            {error && <p className="desktop-dialog-error" role="alert">{error}</p>}
          </div>
          <footer className="desktop-dialog-footer">
            {/* Cancel holds the focus: ending a link should not be one Enter away. */}
            <button className="desktop-dialog-button" type="button" disabled={pending}
              data-desktop-dialog-initial-focus="true" onClick={onCancel}>
              {t("common.action.cancel")}
            </button>
            <button className="desktop-dialog-button destructive" type="button" disabled={pending}
              aria-busy={pending || undefined} onClick={() => void confirm()}>
              {t(pending ? "cloud.disconnect.progress" : "cloud.disconnect.confirm")}
            </button>
          </footer>
        </DesktopDialogSurface>
      </DesktopDialogRoot>
    </DesktopOverlayLayer>
  );
}
