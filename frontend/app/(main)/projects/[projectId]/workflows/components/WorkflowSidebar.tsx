'use client';

import { Clock3 } from 'lucide-react';
import type { WorkflowConnection, WorkflowProviderSpec, WorkflowStatusItem } from '@/lib/workflowApi';
import { ProviderMark, StatusPill } from './WorkflowPrimitives';
import { providerName, triggerFromStatus, triggerLabel, workflowName, type DetailMode } from './workflowHelpers';
import styles from './WorkflowPage.module.css';

export function WorkflowSidebar({
  connections,
  connectionsLoading,
  providersById,
  statusById,
  mode,
  selectedConnectionId,
  onSelect,
}: {
  connections: WorkflowConnection[];
  connectionsLoading: boolean;
  providersById: Map<string, WorkflowProviderSpec>;
  statusById: Map<string, WorkflowStatusItem>;
  mode: DetailMode;
  selectedConnectionId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className={styles.workflowSidebar}>
      <div className={styles.workflowList}>
        {connectionsLoading ? (
          <div className={styles.emptyState}>Loading workflows...</div>
        ) : connections.length === 0 ? (
          <div className={styles.emptyState}>No workflows yet.</div>
        ) : (
          connections.map((connection) => {
            const provider = providersById.get(connection.provider);
            const status = statusById.get(connection.id);
            const selected = mode === 'detail' && selectedConnectionId === connection.id;
            const trigger = triggerFromStatus(status);
            return (
              <button
                type="button"
                key={connection.id}
                className={selected ? `${styles.workflowListItem} ${styles.selected}` : styles.workflowListItem}
                onClick={() => onSelect(connection.id)}
              >
                <div className={styles.listIcon}>
                  <ProviderMark provider={provider} />
                </div>
                <div className={styles.listMain}>
                  <div className={styles.listTitleRow}>
                    <div className={styles.listTitle}>{workflowName(connection, provider)}</div>
                    <StatusPill status={connection.status} />
                  </div>
                  <div className={styles.listMeta}>
                    <span>{providerName(provider, connection.provider)}</span>
                    <span>-&gt;</span>
                    <span>{connection.path || 'Project root'}</span>
                    <span className={styles.listMetaDivider}>·</span>
                    <Clock3 size={12} />
                    <span>{triggerLabel(trigger.mode, trigger.schedule)}</span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
