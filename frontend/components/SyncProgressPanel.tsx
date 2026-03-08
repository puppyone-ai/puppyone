'use client';

import { type ImportStatus, getStatusInfo } from '../lib/importApi';

interface SyncProgressPanelProps {
  taskId: string;
  status?: ImportStatus;
  message?: string;
  error?: string;
  onComplete?: (contentNodeId: string) => void;
  onError?: (error: string) => void;
  onCancel?: () => void;
}

/**
 * SyncProgressPanel — now a simple status display.
 * SaaS imports complete synchronously, so no polling is needed.
 * Kept for backward compatibility; renders a static completed state.
 */
export function SyncProgressPanel({
  status = 'completed',
  message,
  error,
  onCancel,
}: SyncProgressPanelProps) {
  const statusInfo = getStatusInfo(status);
  const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled';

  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 500,
          }}
          className={`${statusInfo.color} ${statusInfo.bgColor}`}
        >
          {statusInfo.label}
        </span>

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

      <div style={progressBarContainerStyle}>
        <div
          style={{
            ...progressBarFillStyle,
            width: isTerminal ? '100%' : '50%',
            background: status === 'failed' ? '#ef4444' :
                       status === 'completed' ? '#22c55e' : '#3b82f6',
          }}
        />
      </div>

      <div style={{ color: '#A1A1AA', fontSize: 12, minHeight: 16 }}>
        {message || (status === 'completed' ? 'Import completed' : 'Processing...')}
      </div>

      {error && (
        <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}

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

export default SyncProgressPanel;
