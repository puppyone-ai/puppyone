'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getImportTask,
  isTerminalStatus,
  getStatusInfo,
  formatBytes,
  type ImportTaskResponse,
  type ImportStatus,
} from '../lib/importApi';

interface SyncProgressPanelProps {
  taskId: string;
  onComplete?: (contentNodeId: string) => void;
  onError?: (error: string) => void;
  onCancel?: () => void;
}

export function SyncProgressPanel({
  taskId,
  onComplete,
  onError,
  onCancel,
}: SyncProgressPanelProps) {
  const [status, setStatus] = useState<ImportTaskResponse | null>(null);
  const [polling, setPolling] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const result = await getImportTask(taskId);
      setStatus(result);

      const isTerminal = isTerminalStatus(result.status);
      if (isTerminal) {
        setPolling(false);

        if (result.status === 'completed' && result.content_node_id && onComplete) {
          onComplete(result.content_node_id);
        } else if (result.status === 'failed' && result.error && onError) {
          onError(result.error);
        }
      }
    } catch (error) {
      console.error('Failed to fetch import status:', error);
    }
  }, [taskId, onComplete, onError]);

  useEffect(() => {
    // Initial fetch
    fetchStatus();

    // Poll every second while active
    let interval: NodeJS.Timeout | null = null;
    if (polling) {
      interval = setInterval(fetchStatus, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [fetchStatus, polling]);

  if (!status) {
    return (
      <div style={containerStyle}>
        <div style={spinnerStyle} />
        <span style={{ color: '#71717A', fontSize: 13 }}>Connecting...</span>
      </div>
    );
  }

  const statusInfo = getStatusInfo(status.status);
  const progressPercent = Math.max(0, Math.min(100, status.progress));
  const isTerminal = isTerminalStatus(status.status);

  return (
    <div style={containerStyle}>
      {/* Status badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 500,
              color: statusInfo.color.replace('text-', ''),
              backgroundColor: statusInfo.bgColor.replace('bg-', ''),
            }}
            className={`${statusInfo.color} ${statusInfo.bgColor}`}
          >
            {statusInfo.label}
          </span>
          {!isTerminal && (
            <span style={{ color: '#71717A', fontSize: 12 }}>
              {progressPercent}%
            </span>
          )}
        </div>
        
        {!isTerminal && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#71717A',
              fontSize: 12,
              cursor: 'pointer',
              padding: '2px 6px',
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div style={progressBarContainerStyle}>
        <div
          style={{
            ...progressBarFillStyle,
            width: `${progressPercent}%`,
            background: status.status === 'failed' ? '#ef4444' : 
                       status.status === 'completed' ? '#22c55e' : '#3b82f6',
          }}
        />
      </div>

      {/* Progress message */}
      <div style={{ color: '#A1A1AA', fontSize: 12, minHeight: 16 }}>
        {status.message || 'Processing...'}
      </div>

      {/* Stats */}
      {status.items_count != null && status.items_count > 0 && (
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#71717A' }}>
          <span>
            {status.items_count} items
          </span>
        </div>
      )}

      {/* Error message */}
      {status.error && (
        <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>
          {status.error}
        </div>
      )}
    </div>
  );
}

// Styles
const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '12px 16px',
  background: '#1C1C1E',
  borderRadius: 8,
  border: '1px solid #3F3F46',
};

const progressBarContainerStyle: React.CSSProperties = {
  height: 4,
  borderRadius: 2,
  background: '#27272A',
  overflow: 'hidden',
};

const progressBarFillStyle: React.CSSProperties = {
  height: '100%',
  borderRadius: 2,
  transition: 'width 0.3s ease',
};

const spinnerStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  border: '2px solid #3F3F46',
  borderTopColor: '#3b82f6',
  borderRadius: '50%',
  animation: 'spin 1s linear infinite',
};

// Add keyframes for spinner
if (typeof document !== 'undefined') {
  const styleSheet = document.styleSheets[0];
  if (styleSheet) {
    try {
      const keyframes = `@keyframes spin { to { transform: rotate(360deg); } }`;
      styleSheet.insertRule(keyframes, styleSheet.cssRules.length);
    } catch (e) {
      // Keyframes might already exist
    }
  }
}

export default SyncProgressPanel;
