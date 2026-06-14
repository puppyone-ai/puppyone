'use client';

import { RefreshCw } from 'lucide-react';
import { ActionButton } from '@/components/ui/ActionButton';
import { RunResultPill } from './WorkflowPrimitives';
import styles from './WorkflowPage.module.css';
import type { WorkflowShellProps } from './workflowTypes';

export function RecentRuns({ model, actions }: WorkflowShellProps) {
  return (
    <section className={styles.runsSection}>
      <div className={styles.sectionHeader}>
        <div>
          <h3>Recent runs</h3>
        </div>
        {model.mode === 'detail' ? (
          <ActionButton
            size="sm"
            variant="secondary"
            leadingIcon={<RefreshCw size={14} />}
            onClick={() => void actions.refreshAll()}
          >
            Refresh
          </ActionButton>
        ) : null}
      </div>

      {model.mode === 'new' ? (
        <div className={styles.emptyRuns}>Runs appear after this sync is created.</div>
      ) : model.recentRuns.length === 0 ? (
        <div className={styles.emptyRuns}>No runs yet.</div>
      ) : (
        <div className={styles.runsTable}>
          <div className={styles.runsHead}>
            <span>Time</span>
            <span>Result</span>
            <span>Summary</span>
            <span>Duration</span>
          </div>
          {model.recentRuns.map((run) => (
            <div className={styles.runsRow} key={run.id}>
              <span>{run.time}</span>
              <span><RunResultPill result={run.result} /></span>
              <span className={styles.truncate}>{run.items}</span>
              <span>{run.duration}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
