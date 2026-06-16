'use client';

import { useCallback, useState } from 'react';
import { StatusIndicator } from '@/components/ui/StatusDot';
import { createMcpEndpoint } from '@/lib/mcpEndpointsApi';
import type { RepoScope } from '@/lib/repoApi';
import { T } from '../lib/tokens';
import { ProviderIcon } from './icons';

export function McpConnectCard({
  scope,
  projectId,
  onCreated,
}: {
  readonly scope: RepoScope;
  readonly projectId: string;
  readonly onCreated: () => Promise<unknown>;
}) {
  const [creating, setCreating] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      await createMcpEndpoint({
        project_id: projectId,
        path: scope.path,
        name: 'MCP Server',
        accesses: [{ path: scope.path, json_path: '', readonly: scope.mode !== 'rw' }],
      });
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create MCP endpoint');
    } finally {
      setCreating(false);
    }
  }, [creating, projectId, scope.path, scope.mode, onCreated]);

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 8,
        border: `1px solid ${error ? 'color-mix(in srgb, var(--po-danger) 28%, var(--po-border-subtle) 72%)' : hovered ? 'var(--po-border-strong)' : T.cardBorder}`,
        background: T.bg,
        overflow: 'hidden',
        transition: `background 0.15s ${T.ease}, border-color 0.15s ${T.ease}`,
        marginBottom: 10,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          minHeight: 84,
          minWidth: 0,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) max-content',
          alignItems: 'center',
          gap: 14,
          padding: '14px 18px',
          boxSizing: 'border-box',
          background: hovered ? 'color-mix(in srgb, var(--po-panel) 78%, var(--po-control) 22%)' : 'transparent',
          transition: `background 0.15s ${T.ease}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <McpIconTile />
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
              <span
                style={{
                  minWidth: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  fontSize: 14,
                  lineHeight: '18px',
                  fontWeight: 500,
                  color: T.text1,
                  fontFamily: T.fontSans,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                MCP Server
              </span>
              <McpInlineStatus errored={!!error} />
            </div>
            <div
              style={{
                fontSize: 12,
                color: error ? 'var(--po-danger)' : T.text2,
                fontFamily: T.fontSans,
                lineHeight: '18px',
                fontWeight: 400,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={error || 'Create a scoped Model Context Protocol endpoint for external AI clients.'}
            >
              {error || 'Create a scoped Model Context Protocol endpoint for external AI clients.'}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            minWidth: 0,
            alignItems: 'flex-end',
            justifyContent: 'center',
            flexDirection: 'column',
          }}
        >
          <button
            type='button'
            disabled={creating}
            onClick={handleCreate}
            style={{
              height: 34,
              minWidth: 132,
              borderRadius: 7,
              border: `1px solid ${error ? 'color-mix(in srgb, var(--po-danger) 28%, var(--po-border-strong) 72%)' : hovered && !creating ? 'var(--po-border-strong)' : T.border}`,
              background: creating
                ? 'color-mix(in srgb, var(--po-control) 46%, var(--po-panel) 54%)'
                : hovered
                  ? 'color-mix(in srgb, var(--po-panel) 72%, var(--po-control) 28%)'
                  : 'transparent',
              color: error ? 'var(--po-danger)' : creating ? T.text3 : T.text2,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '0 12px',
              fontSize: 12,
              lineHeight: '16px',
              fontWeight: 500,
              fontFamily: T.fontSans,
              cursor: creating ? 'wait' : 'pointer',
              opacity: creating ? 0.68 : 1,
              transition: `background 0.15s ${T.ease}, border-color 0.15s ${T.ease}, color 0.15s ${T.ease}`,
            }}
          >
            <span>{creating ? 'Creating endpoint' : error ? 'Retry' : 'Create endpoint'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function McpIconTile() {
  return (
    <div
      style={{
        height: 34,
        width: 34,
        borderRadius: 7,
        background: 'color-mix(in srgb, var(--po-control) 76%, var(--po-canvas) 24%)',
        border: `1px solid ${T.cardBorder}`,
        color: T.text2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <ProviderIcon provider='mcp' size={17} variant='mono' />
    </div>
  );
}

function McpInlineStatus({ errored }: { readonly errored: boolean }) {
  return (
    <>
      <span aria-hidden style={{ color: T.text4, fontSize: 12, lineHeight: '16px' }}>·</span>
      <StatusIndicator
        status={errored ? 'error' : 'inactive'}
        label={errored ? 'Error' : 'Off'}
        style={{ flexShrink: 0 }}
      />
    </>
  );
}
