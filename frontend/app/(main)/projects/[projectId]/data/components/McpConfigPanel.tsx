'use client';

import React from 'react';
import { PanelShell } from './PanelShell';

interface McpEndpointData {
  id: string;
  name: string;
  api_key: string;
  status: string;
  accesses: { node_id: string; json_path: string; readonly: boolean }[];
}

interface McpConfigPanelProps {
  endpoint: McpEndpointData | null | undefined;
  onClose: () => void;
}

const McpIcon = (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
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

export function McpConfigPanel({ endpoint, onClose }: McpConfigPanelProps) {
  if (!endpoint) {
    return (
      <PanelShell title="MCP Endpoint" icon={McpIcon} onClose={onClose}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#525252', fontSize: 13 }}>
          Loading...
        </div>
      </PanelShell>
    );
  }

  const serverUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/mcp/proxy/${endpoint.api_key}`;
  const targetLabel = endpoint.accesses.length > 0
    ? endpoint.accesses[0].node_id
    : 'Workspace';

  return (
    <PanelShell title={endpoint.name} icon={McpIcon} onClose={onClose}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Connection visualization - keep style aligned with Sync detail panel */}
        <div style={{ borderRadius: 10, padding: '16px 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 88 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#a3a3a3', textAlign: 'center' }}>
                MCP Server
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
          <SectionLabel>Server URL</SectionLabel>
          <CodeBlock>{serverUrl}</CodeBlock>
        </div>
        <div>
          <SectionLabel>API Key</SectionLabel>
          <CodeBlock>{endpoint.api_key}</CodeBlock>
        </div>
        <div>
          <SectionLabel>Cursor Config</SectionLabel>
          <pre style={{ fontSize: 11, color: '#a1a1aa', background: '#141414', border: '1px solid #252525', borderRadius: 6, padding: '8px 10px', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
{JSON.stringify({
  mcpServers: {
    [endpoint.name.toLowerCase().replace(/\s+/g, '-')]: {
      url: serverUrl,
      headers: { 'X-API-KEY': endpoint.api_key },
    }
  }
}, null, 2)}
          </pre>
        </div>
        {endpoint.accesses.length > 0 && (
          <div>
            <SectionLabel>Accesses ({endpoint.accesses.length})</SectionLabel>
            {endpoint.accesses.map((a, i) => (
              <div key={i} style={{ fontSize: 12, color: '#a1a1aa', padding: '4px 0' }}>
                {a.node_id} {a.readonly ? '(read-only)' : '(read-write)'}
              </div>
            ))}
          </div>
        )}
      </div>
    </PanelShell>
  );
}
