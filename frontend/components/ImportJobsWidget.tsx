'use client';

import { useCallback, useMemo } from 'react';
import { Dots } from '@/components/loading';
import { ActivityIconButton } from './ActivityIconButton';
import {
  ACTIVITY_BG,
  ACTIVITY_BORDER,
  ACTIVITY_SHADOW,
  ACTIVITY_WIDTH,
  activityHeaderStyle,
  activityTitleStyle,
} from './activityStyles';
import { cancelImportJob, type ImportJob } from '@/lib/importApi';
import { useProjectImportJobs } from '@/lib/hooks/useImportJobs';

type ImportJobsWidgetProps = {
  projectId?: string;
  inline?: boolean;
};

export function ImportJobsWidget({ projectId, inline = false }: ImportJobsWidgetProps) {
  const { jobs, refresh } = useProjectImportJobs(projectId);
  const activeJobs = useMemo(
    () => jobs.filter(job => job.status === 'queued' || job.status === 'running'),
    [jobs],
  );

  const handleCancel = useCallback(async (job: ImportJob) => {
    await cancelImportJob(job.id);
    await refresh();
  }, [refresh]);

  if (!projectId || activeJobs.length === 0) return null;

  const primaryJob = activeJobs[0];
  const title = activeJobs.length === 1 ? 'Importing' : `${activeJobs.length} imports`;

  const containerStyle: React.CSSProperties = inline
    ? { position: 'relative', fontFamily: 'var(--po-font-sans)' }
    : {
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 9999,
        fontFamily: 'var(--po-font-sans)',
      };

  return (
    <div style={containerStyle}>
      <div
        style={{
          width: ACTIVITY_WIDTH,
          background: ACTIVITY_BG,
          border: ACTIVITY_BORDER,
          borderRadius: 12,
          boxShadow: ACTIVITY_SHADOW,
          backdropFilter: 'blur(28px) saturate(160%)',
          WebkitBackdropFilter: 'blur(28px) saturate(160%)',
          overflow: 'hidden',
          color: 'var(--po-text)',
        }}
      >
        <div style={activityHeaderStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Dots size="xs" tone="info" ariaLabel="Importing" />
            <span style={activityTitleStyle}>{title}</span>
          </div>
          {primaryJob ? (
            <ActivityIconButton
              kind="close"
              title="Cancel import"
              onClick={() => handleCancel(primaryJob)}
            />
          ) : null}
        </div>

        <div style={{ padding: '0 12px 12px' }}>
          {activeJobs.slice(0, 3).map(job => (
            <div key={job.id} style={{ paddingTop: 9 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div
                  style={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 12,
                    color: 'var(--po-text)',
                  }}
                  title={job.source_url}
                >
                  {job.name || shortSource(job.source_url)}
                </div>
                <div
                  style={{
                    flexShrink: 0,
                    fontSize: 11,
                    color: 'var(--po-text-subtle)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {Math.max(0, Math.min(100, job.progress))}%
                </div>
              </div>
              <div
                style={{
                  marginTop: 6,
                  height: 3,
                  overflow: 'hidden',
                  borderRadius: 999,
                  background: 'var(--po-border-subtle)',
                }}
              >
                <div
                  style={{
                    width: `${Math.max(4, Math.min(100, job.progress || 8))}%`,
                    height: '100%',
                    borderRadius: 999,
                    background: 'var(--po-accent)',
                    transition: 'width 0.18s ease-out',
                  }}
                />
              </div>
              <div
                style={{
                  marginTop: 5,
                  fontSize: 11,
                  lineHeight: '15px',
                  color: 'var(--po-text-subtle)',
                }}
              >
                {job.message || phaseLabel(job.phase)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function shortSource(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    return `${url.hostname}${url.pathname}`.replace(/\/$/, '');
  } catch {
    return sourceUrl;
  }
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'queued':
      return 'Queued';
    case 'validating':
      return 'Preparing import';
    case 'fetching':
      return 'Fetching source';
    case 'writing':
      return 'Writing to workspace';
    default:
      return phase;
  }
}
