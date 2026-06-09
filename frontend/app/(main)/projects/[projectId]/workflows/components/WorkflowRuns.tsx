'use client';

import { RefreshCw } from 'lucide-react';
import { RunResultPill } from './WorkflowPrimitives';
import styles from './WorkflowPage.module.css';
import type { WorkflowDetailProps } from './workflowTypes';

export function RecentRuns({
  mode,
  selectedConnection,
  recentRuns,
  onRefreshAll,
}: WorkflowDetailProps) {
  return (
    <section className={styles.runsSection}>
      <div className={styles.sectionHeader}>
        <div>
          <h3>Recent runs</h3>
        </div>
        {mode === 'detail' ? (
          <button type="button" className={`${styles.secondaryButton} ${styles.compactButton}`} onClick={() => void onRefreshAll()}>
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
        ) : null}
      </div>

      {mode === 'new' ? (
        <div className={styles.emptyRuns}>Runs appear after this workflow is created.</div>
      ) : recentRuns.length === 0 ? (
        <div className={styles.emptyRuns}>No runs yet.</div>
      ) : (
        <div className={styles.runsTable}>
          <div className={styles.runsHead}>
            <span>Time</span>
            <span>Result</span>
            <span>Synced items</span>
            <span>Target</span>
            <span>Duration</span>
          </div>
          {recentRuns.map((run) => (
            <div className={styles.runsRow} key={run.id}>
              <span>{run.time}</span>
              <span><RunResultPill result={run.result} /></span>
              <span className={styles.truncate}>{run.items}</span>
              <span className={styles.truncate}>{run.target}</span>
              <span>{run.duration}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
