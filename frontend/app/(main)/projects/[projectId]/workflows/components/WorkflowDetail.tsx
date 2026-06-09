'use client';

import {
  Database,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import { IconButton, StatusPill } from './WorkflowPrimitives';
import styles from './WorkflowPage.module.css';
import { WorkflowFlow } from './WorkflowNodes';
import { RecentRuns } from './WorkflowRuns';
import type { WorkflowDetailProps } from './workflowTypes';
import { dataPath } from './workflowHelpers';

export function WorkflowDetail(props: WorkflowDetailProps) {
  if (!props.hasSelection) {
    return (
      <main className={styles.detailPane}>
        <div className={styles.blankDetail}>
          <Database size={24} />
          <span>No workflow selected.</span>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.detailPane}>
      <DetailHeader {...props} />
      {props.feedback ? (
        <div className={props.feedback.type === 'error' ? `${styles.feedback} ${styles.feedbackError}` : `${styles.feedback} ${styles.feedbackSuccess}`}>
          {props.feedback.text}
        </div>
      ) : null}
      <WorkflowFlow {...props} />
      {props.mode === 'detail' ? <RecentRuns {...props} /> : null}
    </main>
  );
}

function DetailHeader({
  projectId,
  mode,
  selectedConnection,
  detailTitle,
  detailStatus,
  selectedBusy,
  paused,
  usesOAuth,
  canAuthorize,
  authBusy,
  creating,
  missingRequired,
  targetPath,
  onAuthorize,
  onCreate,
  onConnectionAction,
}: WorkflowDetailProps) {
  const showHeaderCreate = mode !== 'new';

  return (
    <header className={styles.detailHeader}>
      <div className={styles.detailTitleBlock}>
        <div className={styles.detailTitleRow}>
          <h2>{detailTitle}</h2>
          <StatusPill status={detailStatus} />
        </div>
      </div>
      <div className={styles.detailActions}>
        {mode === 'detail' && selectedConnection ? (
          <>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={selectedBusy !== null}
              onClick={() => void onConnectionAction(selectedConnection.id, 'refresh')}
            >
              {selectedBusy === 'refresh' ? <Loader2 size={15} className={styles.spin} /> : <Play size={15} />}
              <span>Run now</span>
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={selectedBusy !== null}
              onClick={() => void onConnectionAction(selectedConnection.id, paused ? 'resume' : 'pause')}
            >
              {selectedBusy === 'pause' || selectedBusy === 'resume'
                ? <Loader2 size={15} className={styles.spin} />
                : paused ? <Play size={15} /> : <Pause size={15} />}
              <span>{paused ? 'Resume' : 'Pause'}</span>
            </button>
            <IconButton
              title="Open in Files"
              disabled={!selectedConnection.path}
              onClick={() => window.location.assign(dataPath(projectId, selectedConnection.path))}
            >
              <ExternalLink size={15} />
            </IconButton>
            <IconButton
              title="Delete"
              disabled={selectedBusy !== null}
              onClick={() => void onConnectionAction(selectedConnection.id, 'delete')}
            >
              {selectedBusy === 'delete' ? <Loader2 size={15} className={styles.spin} /> : <Trash2 size={15} />}
            </IconButton>
          </>
        ) : showHeaderCreate ? (
          <>
            {usesOAuth && canAuthorize ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void onAuthorize()}
                disabled={authBusy}
              >
                {authBusy ? <Loader2 size={15} className={styles.spin} /> : <ExternalLink size={15} />}
                <span>Authorize</span>
              </button>
            ) : null}
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void onCreate()}
              disabled={creating || missingRequired || !targetPath.trim()}
            >
              {creating ? <Loader2 size={15} className={styles.spin} /> : <Plus size={15} />}
              <span>Create</span>
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}
