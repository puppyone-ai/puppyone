'use client';

import { TaskStatusWidget } from './TaskStatusWidget';
import { GettingStartedPanel } from './onboarding/GettingStartedPanel';

interface ActivityStackProps {
  showGettingStarted: boolean;
  projectId?: string;
}

/**
 * Single owner for bottom-right transient activity.
 *
 * Individual widgets should render inline inside this stack instead of
 * positioning themselves with `fixed`. This prevents independent overlays
 * (uploads, onboarding, future sync/export jobs) from competing for the
 * same screen corner.
 */
export function ActivityStack({
  showGettingStarted,
  projectId,
}: Readonly<ActivityStackProps>) {
  return (
    <div
      aria-label="Activity"
      style={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {showGettingStarted && (
        <div style={{ pointerEvents: 'auto' }}>
          <GettingStartedPanel projectId={projectId} inline />
        </div>
      )}

      <div style={{ pointerEvents: 'auto' }}>
        <TaskStatusWidget inline />
      </div>
    </div>
  );
}
