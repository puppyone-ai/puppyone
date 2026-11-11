import { useCallback, useEffect, useState } from "react";
import { useLocalization } from "@puppyone/localization";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import type { GitStatusSnapshot } from "../../../types/electron";
import type { HostFileOperation, HostFolderResult } from "../../../../shared/host-contract/types";

type GitRequest = Readonly<{ op: string; paths?: string[]; message?: string }>;

/**
 * Changes in a folder on another of the owner's computers, committed with that
 * computer's own Git. A commit is sent once; if its result is unknown, the panel
 * says so and rereads instead of trying again.
 */
export function RemoteGitPanel({ folderId, session, hostName, refreshKey }: {
  folderId: string; session: DesktopCloudSession; hostName: string; refreshKey?: unknown;
}) {
  const { t } = useLocalization();
  const [status, setStatus] = useState<GitStatusSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const call = useCallback(async <T,>(request: GitRequest): Promise<T> => {
    const result = await window.puppyoneDesktop?.requestHostFolder<T>({ folderId,
      operation: { action: "git", ...request } satisfies HostFileOperation,
      expectedSession: { userId: session.user_id, generation: session.session_generation } }) as HostFolderResult<T> | undefined;
    if (!result) throw new Error(t("hosts.git.unavailable"));
    if (!result.ok) {
      throw new Error(result.outcomeUnknown ? t("hosts.git.unconfirmed", { host: hostName })
        : t(`hosts.git.error.${result.code === "folder_unavailable" ? "not_allowed" : "failed"}`, { host: hostName }));
    }
    return result.result;
  }, [folderId, session.user_id, session.session_generation, hostName, t]);
  const reload = useCallback(async () => {
    try { setStatus(await call<GitStatusSnapshot>({ op: "status" })); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [call]);
  useEffect(() => { void reload(); }, [reload, refreshKey]);
  const run = async (request: GitRequest) => {
    setBusy(true);
    try { await call(request); if (request.op === "commit") setMessage(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); await reload(); }
  };
  if (status && !status.isRepo) return <p style={{ padding: 8 }}>{t("hosts.git.noRepository")}</p>;
  const staged = status?.stagedEntries ?? [];
  const changed = [...(status?.unstagedEntries ?? []), ...(status?.untrackedEntries ?? [])];
  return <div className="desktop-remote-git" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8 }}>
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <strong>{status?.branch ?? ""}</strong>
      <button type="button" onClick={() => void reload()} disabled={busy}>{t("hosts.catalog.refresh")}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    <textarea aria-label={t("hosts.git.message")} placeholder={t("hosts.git.message")} value={message}
      onChange={(event) => setMessage(event.target.value)} rows={3} disabled={busy} />
    <button type="button" disabled={busy || !message.trim() || staged.length === 0}
      onClick={() => void run({ op: "commit", message })}>{t("hosts.git.commit")}</button>
    <section aria-label={t("hosts.git.staged")}>
      <div style={{ display: "flex", gap: 8 }}>
        <strong>{t("hosts.git.staged")} · {staged.length}</strong>
        {staged.length > 0 && <button type="button" disabled={busy} onClick={() => void run({ op: "unstage_all" })}>
          {t("hosts.git.unstageAll")}</button>}
      </div>
      {staged.map((entry) => <div key={`s:${entry.path}`} style={{ display: "flex", gap: 8 }}>
        <span dir="auto">{entry.path}</span>
        <button type="button" disabled={busy} onClick={() => void run({ op: "unstage", paths: [entry.path] })}>−</button>
      </div>)}
    </section>
    <section aria-label={t("hosts.git.changes")}>
      <div style={{ display: "flex", gap: 8 }}>
        <strong>{t("hosts.git.changes")} · {changed.length}</strong>
        {changed.length > 0 && <button type="button" disabled={busy} onClick={() => void run({ op: "stage_all" })}>
          {t("hosts.git.stageAll")}</button>}
      </div>
      {changed.length === 0 && staged.length === 0 && status && <p>{t("hosts.git.clean")}</p>}
      {changed.map((entry) => <div key={`c:${entry.path}`} style={{ display: "flex", gap: 8 }}>
        <span dir="auto">{entry.path}</span>
        <button type="button" disabled={busy} onClick={() => void run({ op: "stage", paths: [entry.path] })}>+</button>
      </div>)}
    </section>
  </div>;
}
