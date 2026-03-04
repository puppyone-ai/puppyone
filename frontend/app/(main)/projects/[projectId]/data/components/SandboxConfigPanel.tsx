'use client';

import React from 'react';
import { PanelShell } from './PanelShell';

interface SandboxMount {
  node_id: string;
  mount_path: string;
  permissions?: { read?: boolean; write?: boolean; exec?: boolean };
}

interface SandboxEndpointData {
  id: string;
  name: string;
  access_key: string;
  status: string;
  runtime: string;
  timeout_seconds: number;
  resource_limits?: { memory_mb?: number; cpu_shares?: number };
  mounts: SandboxMount[];
}

interface SandboxConfigPanelProps {
  endpoint: SandboxEndpointData | null | undefined;
  onClose: () => void;
}

const SandboxIcon = (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

const FolderIcon = (
  <img src="/icons/folder.svg" alt="Folder" width={36} height={36} style={{ display: 'block' }} />
);

function ConnectionArrow() {
  return (
    <svg width="48" height="16" viewBox="0 0 48 16" fill="none" stroke="#4ade80" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 5h44M6 2L2 5l4 3" />
      <path d="M42 8l4 3-4 3M2 11h44" />
    </svg>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
      {children}
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, color: '#a1a1aa', background: '#141414', border: '1px solid #252525', borderRadius: 6, padding: '8px 10px', wordBreak: 'break-all', fontFamily: 'monospace' }}>
      {children}
    </div>
  );
}

export function SandboxConfigPanel({ endpoint, onClose }: SandboxConfigPanelProps) {
  if (!endpoint) {
    return (
      <PanelShell title="Sandbox" icon={SandboxIcon} onClose={onClose}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#525252', fontSize: 13 }}>
          Loading...
        </div>
      </PanelShell>
    );
  }

  const execUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/sandbox-endpoints/${endpoint.id}/exec`;
  const targetLabel = endpoint.mounts.length > 0
    ? endpoint.mounts[0].node_id
    : 'Workspace';

  return (
    <PanelShell title={endpoint.name} icon={SandboxIcon} onClose={onClose}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Connection visualization - aligned with Sync/MCP detail panels */}
        <div style={{ borderRadius: 10, padding: '16px 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 88 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              </div>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#a3a3a3', textAlign: 'center' }}>
                Sandbox
              </div>
            </div>

            <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
              <ConnectionArrow />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 88 }}>
              {FolderIcon}
              <div style={{
                fontSize: 11, fontWeight: 500, color: '#a3a3a3', textAlign: 'center',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 88,
              }}>
                {targetLabel}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: endpoint.status === 'active' ? '#22c55e' : '#f59e0b' }} />
            <span style={{ fontSize: 11, color: '#a3a3a3' }}>{endpoint.status}</span>
          </div>
        </div>

        <div>
          <SectionLabel>Status</SectionLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: endpoint.status === 'active' ? '#10b981' : '#f59e0b' }} />
            <span style={{ fontSize: 13, color: '#e4e4e7' }}>{endpoint.status}</span>
          </div>
        </div>
        <div>
          <SectionLabel>Runtime</SectionLabel>
          <span style={{ fontSize: 13, color: '#e4e4e7' }}>{endpoint.runtime}</span>
        </div>
        <div>
          <SectionLabel>Access Key</SectionLabel>
          <CodeBlock>{endpoint.access_key}</CodeBlock>
        </div>
        <div>
          <SectionLabel>Usage</SectionLabel>
          <pre style={{ fontSize: 11, color: '#a1a1aa', background: '#141414', border: '1px solid #252525', borderRadius: 6, padding: '8px 10px', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
{`curl -X POST ${execUrl} \\
  -H "X-Access-Key: ${endpoint.access_key}" \\
  -H "Content-Type: application/json" \\
  -d '{"command": "ls /workspace"}'`}
          </pre>
        </div>
        <div>
          <SectionLabel>Resource Limits</SectionLabel>
          <span style={{ fontSize: 12, color: '#a1a1aa' }}>
            {endpoint.resource_limits?.memory_mb ?? 128}MB RAM · {endpoint.resource_limits?.cpu_shares ?? 0.5} CPU · {endpoint.timeout_seconds}s timeout
          </span>
        </div>
        {endpoint.mounts.length > 0 && (
          <div>
            <SectionLabel>Mounts ({endpoint.mounts.length})</SectionLabel>
            {endpoint.mounts.map((m, i) => (
              <div key={i} style={{ fontSize: 12, color: '#a1a1aa', padding: '4px 0' }}>
                {m.mount_path} → {m.node_id} ({m.permissions?.write ? 'read-write' : 'read-only'})
              </div>
            ))}
          </div>
        )}
      </div>
    </PanelShell>
  );
}
