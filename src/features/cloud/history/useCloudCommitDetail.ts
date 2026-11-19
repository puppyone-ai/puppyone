import { useEffect, useState } from "react";
import type { DesktopCloudHistoryCommit } from "../../../lib/cloudHistoryApi";
import { acquireHistoryDetail, type HistoryContext } from "./historyRepository";

export function useCloudCommitDetail(commit: DesktopCloudHistoryCommit, context?: HistoryContext) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; commit?: DesktopCloudHistoryCommit; failed?: boolean } | null>(null);
  const key = JSON.stringify([context?.session.user_id, context?.session.session_generation,
    context?.session.api_base_url, context?.apiBaseUrl, context?.projectId, context?.revisionKey, commit.commit_id, attempt]);
  useEffect(() => {
    if (commit.changes_loaded !== false || !context) return;
    let active = true;
    const subscription = acquireHistoryDetail(context, commit.commit_id);
    if (subscription.cached) setResult({ key, commit: subscription.cached });
    void subscription.promise.then(value => { if (active) setResult({ key, commit: value }); },
      () => { if (active) setResult({ key, failed: true }); });
    return () => { active = false; subscription.release(); };
    // key captures every authority/revision identity; token refresh does not duplicate reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, commit.changes_loaded]);
  const current = result?.key === key ? result : null;
  return { commit: commit.changes_loaded === false ? current?.commit ?? commit : commit,
    retry: () => setAttempt(value => value + 1), failed: Boolean(current?.failed), loading: commit.changes_loaded === false && !current?.commit && !current?.failed };
}
