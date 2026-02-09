'use client';

import { useState } from 'react';
import { createConnection } from '../lib/dbConnectorApi';

type SupabaseConnectDialogProps = {
  projectId: string;
  onClose: () => void;
  onConnected: (connectionId: string) => void;
};

export function SupabaseConnectDialog({ projectId, onClose, onConnected }: SupabaseConnectDialogProps) {
  const [projectUrl, setProjectUrl] = useState('');
  const [serviceRoleKey, setServiceRoleKey] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = projectUrl.trim().length > 0 && serviceRoleKey.trim().length > 0;

  const handleConnect = async () => {
    if (!canSubmit) return;
    setIsConnecting(true);
    setError(null);

    try {
      const urlHost = new URL(projectUrl.trim()).hostname;
      const ref = urlHost.split('.')[0];
      const name = `Supabase (${ref})`;

      const { connection } = await createConnection(projectId, {
        name,
        provider: 'supabase',
        project_url: projectUrl.trim(),
        service_role_key: serviceRoleKey.trim(),
      });

      onConnected(connection.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || 'Connection failed. Please check your credentials.');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        backdropFilter: 'blur(2px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1C1C1E',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
          width: 480,
          maxWidth: '90vw',
          boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'dialog-fade-in 0.2s ease-out',
        }}
        onClick={e => e.stopPropagation()}
      >
        <style jsx>{`
          @keyframes dialog-fade-in {
            from { opacity: 0; transform: scale(0.98); }
            to { opacity: 1; transform: scale(1); }
          }
          input::placeholder { color: #525252; }
        `}</style>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="20" height="20" viewBox="0 0 109 113" fill="none">
              <path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill="url(#sp0)"/>
              <path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill="url(#sp1)" fillOpacity="0.2"/>
              <path d="M45.317 2.07103C48.1765 -1.53037 53.9745 0.442937 54.0434 5.041L54.4849 72.2922H9.83113C1.64038 72.2922 -2.92775 62.8321 2.1655 56.4175L45.317 2.07103Z" fill="#3ECF8E"/>
              <defs>
                <linearGradient id="sp0" x1="53.9738" y1="54.974" x2="94.1635" y2="71.8295" gradientUnits="userSpaceOnUse"><stop stopColor="#249361"/><stop offset="1" stopColor="#3ECF8E"/></linearGradient>
                <linearGradient id="sp1" x1="36.1558" y1="30.578" x2="54.4844" y2="65.0806" gradientUnits="userSpaceOnUse"><stop/><stop offset="1" stopOpacity="0"/></linearGradient>
              </defs>
            </svg>
            <span style={{ color: '#e4e4e7', fontSize: 16, fontWeight: 600 }}>Connect Supabase</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', padding: 4, fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Project URL */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, color: '#a1a1aa', fontWeight: 500 }}>Project URL</label>
            <input
              type="text"
              placeholder="https://abcdefg.supabase.co"
              value={projectUrl}
              onChange={e => { setProjectUrl(e.target.value); setError(null); }}
              style={{
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8, padding: '10px 12px', color: '#e4e4e7', fontSize: 14, outline: 'none',
              }}
              onFocus={e => e.target.style.borderColor = 'rgba(62, 207, 142, 0.5)'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
              autoFocus
            />
            <span style={{ fontSize: 12, color: '#525252' }}>Settings → API → Project URL</span>
          </div>

          {/* Service Role Key */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 13, color: '#a1a1aa', fontWeight: 500 }}>Service Role Key</label>
            <input
              type="password"
              placeholder="eyJhbGciOiJIUzI1NiIs..."
              value={serviceRoleKey}
              onChange={e => { setServiceRoleKey(e.target.value); setError(null); }}
              onKeyDown={e => { if (e.key === 'Enter' && canSubmit) handleConnect(); }}
              style={{
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8, padding: '10px 12px', color: '#e4e4e7', fontSize: 14, outline: 'none',
                fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
              }}
              onFocus={e => e.target.style.borderColor = 'rgba(62, 207, 142, 0.5)'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
            />
            <span style={{ fontSize: 12, color: '#525252' }}>Settings → API → Project API keys → service_role</span>
          </div>

          {/* Info */}
          <div style={{ padding: '10px 12px', background: 'rgba(62, 207, 142, 0.06)', border: '1px solid rgba(62, 207, 142, 0.1)', borderRadius: 8, color: '#6ee7b7', fontSize: 12, lineHeight: 1.5 }}>
            Service Role Key is read-only in our system. We only fetch data, never modify your database.
          </div>

          {/* Error */}
          {error && (
            <div style={{ padding: '10px 12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 8, color: '#fca5a5', fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#a1a1aa', cursor: 'pointer', fontSize: 14 }}>
            Cancel
          </button>
          <button
            onClick={handleConnect}
            disabled={!canSubmit || isConnecting}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: canSubmit && !isConnecting ? '#3ECF8E' : 'rgba(62, 207, 142, 0.3)',
              color: canSubmit && !isConnecting ? '#000' : 'rgba(0,0,0,0.4)',
              cursor: canSubmit && !isConnecting ? 'pointer' : 'not-allowed',
              fontSize: 14, fontWeight: 600,
            }}
          >
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
