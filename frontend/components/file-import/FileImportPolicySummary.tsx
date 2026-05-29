'use client';

import {
  PER_BATCH_MAX_BYTES,
  PER_BATCH_MAX_FILES,
  PER_FILE_MAX_BYTES,
  type BatchPolicyResult,
} from '@/lib/uploadPolicy';
import { formatBytes } from './format';
import type { SkippedSummaryRow } from './types';

interface FileImportPolicySummaryProps {
  policyResult: BatchPolicyResult;
  includeHidden: boolean;
  includeIgnored: boolean;
  setIncludeHidden: (updater: (value: boolean) => boolean) => void;
  setIncludeIgnored: (updater: (value: boolean) => boolean) => void;
}

export function FileImportPolicySummary({
  policyResult,
  includeHidden,
  includeIgnored,
  setIncludeHidden,
  setIncludeIgnored,
}: FileImportPolicySummaryProps) {
  const {
    accepted,
    skipped,
    totalAcceptedBytes,
    reasonCounts,
    limitViolations,
    shouldPreflight,
  } = policyResult;
  const totalSkipped = skipped.length;
  const exceedsHardLimits = limitViolations.length > 0;

  if (!(shouldPreflight || totalSkipped > 0 || exceedsHardLimits)) {
    return null;
  }

  const skippedRows = buildSkippedRows({
    reasonCounts,
    includeHidden,
    includeIgnored,
    setIncludeHidden,
    setIncludeIgnored,
  });
  const gitHistorySkipped = skipped.some((item) => item.reason === 'blocklist:.git');

  return (
    <div
      style={{
        background: 'var(--po-control)',
        padding: '10px 14px',
        borderRadius: 6,
        marginBottom: 12,
        fontSize: 12,
        color: 'var(--po-text-muted)',
      }}
    >
      <div style={{ marginBottom: skippedRows.length > 0 ? 8 : 0 }}>
        <span style={{ color: 'var(--po-text)', fontWeight: 500 }}>
          {accepted.length}
        </span>{' '}
        file{accepted.length === 1 ? '' : 's'} ·{' '}
        <span style={{ color: 'var(--po-text)' }}>
          {formatBytes(totalAcceptedBytes)}
        </span>{' '}
        will upload
        {totalSkipped > 0 && (
          <>
            {' '}·{' '}
            <span style={{ color: 'var(--po-warning)' }}>
              {totalSkipped} skipped
            </span>
          </>
        )}
      </div>
      {exceedsHardLimits && <HardLimitNotice />}
      {gitHistorySkipped && <GitHistoryNotice />}
      {skippedRows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {skippedRows.map((row, index) => (
            <label
              key={`${row.reason ?? row.label}:${index}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                cursor: row.toggle ? 'pointer' : 'default',
                opacity: row.toggle ? 1 : 0.7,
              }}
            >
              {row.toggle ? (
                <input
                  type="checkbox"
                  checked={!!row.toggleValue}
                  onChange={row.toggle}
                  style={{ margin: 0 }}
                />
              ) : (
                <span style={{ width: 13, display: 'inline-block' }} />
              )}
              <span style={{ flex: 1 }}>{row.label}</span>
              <span style={{ color: 'var(--po-text-subtle)' }}>
                {row.count}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function buildSkippedRows(args: {
  reasonCounts: BatchPolicyResult['reasonCounts'];
  includeHidden: boolean;
  includeIgnored: boolean;
  setIncludeHidden: (updater: (value: boolean) => boolean) => void;
  setIncludeIgnored: (updater: (value: boolean) => boolean) => void;
}): SkippedSummaryRow[] {
  const {
    reasonCounts,
    includeHidden,
    includeIgnored,
    setIncludeHidden,
    setIncludeIgnored,
  } = args;
  const rows: SkippedSummaryRow[] = [];

  if (reasonCounts.blocklist > 0) {
    rows.push({
      label: 'blocked folders/files (.git, node_modules, ...)',
      count: reasonCounts.blocklist,
      reason: 'blocklist:.git',
    });
  }
  if (reasonCounts.gitignore > 0) {
    rows.push({
      label: 'matched .gitignore / .puppyignore',
      count: reasonCounts.gitignore,
      reason: 'gitignore',
      toggle: () => setIncludeIgnored((value) => !value),
      toggleValue: includeIgnored,
    });
  }
  if (reasonCounts.hidden > 0) {
    rows.push({
      label: 'hidden files (start with .)',
      count: reasonCounts.hidden,
      reason: 'hidden',
      toggle: () => setIncludeHidden((value) => !value),
      toggleValue: includeHidden,
    });
  }
  if (reasonCounts.tooLarge > 0) {
    rows.push({
      label: `larger than ${formatBytes(PER_FILE_MAX_BYTES)} per file`,
      count: reasonCounts.tooLarge,
      reason: 'too_large',
    });
  }

  return rows;
}

function HardLimitNotice() {
  return (
    <div
      style={{
        margin: '0 0 8px',
        padding: '8px 10px',
        border: '1px solid color-mix(in srgb, var(--po-danger) 26%, transparent)',
        borderRadius: 6,
        background: 'color-mix(in srgb, var(--po-danger) 8%, transparent)',
        color: 'var(--po-danger)',
        lineHeight: '18px',
      }}
    >
      <span style={{ fontWeight: 600 }}>This batch is too large.</span>{' '}
      Upload at most {PER_BATCH_MAX_FILES.toLocaleString()} files or{' '}
      {formatBytes(PER_BATCH_MAX_BYTES)} after ignored and blocked files are removed.
      Split this folder into smaller uploads.
    </div>
  );
}

function GitHistoryNotice() {
  return (
    <div
      style={{
        margin: '0 0 8px',
        padding: '8px 10px',
        border: '1px solid var(--po-border-subtle)',
        borderRadius: 6,
        background: 'var(--po-panel)',
        color: 'var(--po-text-muted)',
        lineHeight: '18px',
      }}
    >
      <span style={{ color: 'var(--po-text)', fontWeight: 500 }}>
        Git history will be skipped.
      </span>{' '}
      Folder upload imports the current snapshot only. Use Start with Git or the Git protocol to preserve full repository history.
    </div>
  );
}
