'use client';

import {
  Database,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Trash2,
} from 'lucide-react';
import { ActionButton } from '@/components/ui/ActionButton';
import { IconButton, StatusPill } from './WorkflowPrimitives';
import styles from './WorkflowPage.module.css';
import { WorkflowFlow } from './WorkflowNodes';
import { RecentRuns } from './WorkflowRuns';
import type { WorkflowShellProps } from './workflowTypes';
import { dataPath, providerName } from './workflowHelpers';

export function WorkflowDetail({ model, actions }: WorkflowShellProps) {
  if (!model.hasSelection) {
    return (
      <section className={styles.detailPane}>
        <div className={styles.blankDetail}>
          <Database size={22} />
          <span>No integration selected.</span>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.detailPane}>
      <DetailHeader model={model} actions={actions} />
      {model.feedback ? (
        <div className={model.feedback.type === 'error' ? `${styles.feedback} ${styles.feedbackError}` : `${styles.feedback} ${styles.feedbackSuccess}`}>
          {model.feedback.text}
        </div>
      ) : null}
      <WorkflowFlow model={model} actions={actions} />
      {model.mode === 'detail' ? <RecentRuns model={model} actions={actions} /> : null}
    </section>
  );
}

function DetailHeader({ model, actions }: WorkflowShellProps) {
  const sourceName = providerName(
    model.detailProvider,
    model.selectedConnection?.provider || 'Source',
  );
  const targetName = model.selectedConnection?.path || model.targetPath || 'Project root';

  return (
    <header className={styles.detailHeader}>
      <div className={styles.detailTitleBlock}>
        <div className={styles.detailTitleRow}>
          <h2>{model.detailTitle}</h2>
          <StatusPill status={model.detailStatus} />
        </div>
        <div className={styles.detailSubtitle}>
          {model.mode === 'new' ? 'Configure a new sync' : `${sourceName} syncs into ${targetName}`}
        </div>
      </div>
      {model.mode === 'detail' && model.selectedConnection ? (
        <div className={styles.detailActions}>
          <ActionButton
            variant="secondary"
            size="sm"
            disabled={model.selectedBusy !== null}
            loading={model.selectedBusy === 'refresh'}
            leadingIcon={model.selectedBusy === 'refresh' ? <Loader2 size={15} className={styles.spin} /> : <Play size={15} />}
            onClick={() => void actions.runAction(model.selectedConnection!.id, 'refresh')}
          >
            Run now
          </ActionButton>
          <ActionButton
            variant="secondary"
            size="sm"
            disabled={model.selectedBusy !== null}
            loading={model.selectedBusy === 'pause' || model.selectedBusy === 'resume'}
            leadingIcon={model.selectedBusy === 'pause' || model.selectedBusy === 'resume'
              ? <Loader2 size={15} className={styles.spin} />
              : model.paused ? <Play size={15} /> : <Pause size={15} />}
            onClick={() => void actions.runAction(model.selectedConnection!.id, model.paused ? 'resume' : 'pause')}
          >
            {model.paused ? 'Resume' : 'Pause'}
          </ActionButton>
          <IconButton
            title="Open in Files"
            disabled={!model.selectedConnection.path}
            onClick={() => window.location.assign(dataPath(model.projectId, model.selectedConnection?.path))}
          >
            <ExternalLink size={15} />
          </IconButton>
          <IconButton
            title="Delete"
            disabled={model.selectedBusy !== null}
            onClick={() => void actions.runAction(model.selectedConnection!.id, 'delete')}
          >
            {model.selectedBusy === 'delete' ? <Loader2 size={15} className={styles.spin} /> : <Trash2 size={15} />}
          </IconButton>
        </div>
      ) : null}
    </header>
  );
}
