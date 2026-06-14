'use client';

/**
 * Remote Sandbox — scope-level access method card.
 *
 * The runtime is still scope-keyed rather than a persisted Connector row, but
 * the product surface should read like the other ways into a scope. The default
 * state is therefore a connector-style row; provider, sync policy, and SSH-key
 * setup live behind Configure.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import useSWR from 'swr';
import { AiHandoffButton } from '@/components/ui/AiHandoffButton';
import { StatusIndicator } from '@/components/ui/StatusDot';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { RepoScope } from '@/lib/repoApi';
import {
  connectScopeSandbox,
  getScopeSandboxProviders,
  getScopeSandboxStatus,
  revokeScopeSandbox,
  type SandboxConnectInfo,
  type SandboxProvider,
  type SandboxStatus,
} from '@/lib/scopeSandboxApi';
import {
  describeSyncPolicy,
  getSyncPolicy,
  putSyncSettings,
  type SyncPersona,
  type SyncPolicyResolved,
} from '@/lib/scopeSyncApi';
import { T } from '../lib/tokens';
import { formatScopePath } from './ScopeHeader';
import { CommandBlock, KvBlock, SubSectionLabel } from './ui-blocks';

type WorkspaceVisualState = 'off' | 'ready' | 'active';

function fmtExpiry(epoch: number): string {
  try {
    return new Date(epoch * 1000).toLocaleString();
  } catch {
    return '-';
  }
}

export function SandboxConnectCard({
  scope,
  projectId,
}: {
  readonly scope: RepoScope;
  readonly projectId: string;
}) {
  const [provider, setProvider] = useState<SandboxProvider | null>(null);
  const [publicKey, setPublicKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<SandboxConnectInfo | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [savingSync, setSavingSync] = useState(false);

  const { data: providerInfo } = useSWR(
    ['scope-sandbox-providers'],
    getScopeSandboxProviders,
    { revalidateOnFocus: false, dedupingInterval: 300000 },
  );
  const providerList = providerInfo?.providers ?? [
    { id: 'e2b' as const, label: 'E2B', configured: true },
    { id: 'fly' as const, label: 'Fly', configured: false },
  ];

  useEffect(() => {
    if (provider === null && providerInfo?.default) setProvider(providerInfo.default);
  }, [provider, providerInfo?.default]);

  const effectiveProvider: SandboxProvider = provider ?? providerInfo?.default ?? 'e2b';

  const { data: status, mutate: mutateStatus } = useSWR(
    projectId && scope.id ? ['scope-sandbox-status', projectId, scope.id] : null,
    () => getScopeSandboxStatus(projectId, scope.id),
    { refreshInterval: 20000, revalidateOnFocus: false },
  );

  const { data: syncPolicy, mutate: mutateSyncPolicy } = useSWR(
    projectId && scope.id ? ['scope-sync-policy', projectId, scope.id] : null,
    () => getSyncPolicy(projectId, scope.id),
    { revalidateOnFocus: false },
  );

  const keyLooksValid = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-)\s+\S+/.test(publicKey.trim());
  const connected = info != null || (status?.connected ?? false);
  const sandboxState = status?.state ?? 'none';
  const workspaceStarted = sandboxState !== 'none';
  const workspaceVisualState: WorkspaceVisualState = connected ? 'active' : workspaceStarted ? 'ready' : 'off';
  const workspaceOff = workspaceVisualState === 'off';
  const workspaceActive = workspaceVisualState === 'active';
  const alias = `puppy-${scope.id.slice(0, 8)}`;
  const workspacePath = info?.workspace_path ?? status?.workspace_path ?? '';
  const openCommand = connected && workspacePath
    ? `code --remote ssh-remote+${alias} ${workspacePath}`
    : '';

  const updateSync = useCallback(async (patch: { persona?: SyncPersona; auto_sync?: boolean }) => {
    setSavingSync(true);
    try {
      await putSyncSettings(projectId, scope.id, patch);
      await mutateSyncPolicy();
    } finally {
      setSavingSync(false);
    }
  }, [projectId, scope.id, mutateSyncPolicy]);

  const handleConnect = useCallback(async () => {
    if (connecting || !keyLooksValid) return;
    setConnecting(true);
    setError(null);
    try {
      const result = await connectScopeSandbox({
        projectId,
        scopeId: scope.id,
        publicKey: publicKey.trim(),
        provider: effectiveProvider,
      });
      setInfo(result);
      await mutateStatus();
    } catch (err) {
      setError((err as Error).message || 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  }, [connecting, keyLooksValid, projectId, scope.id, publicKey, effectiveProvider, mutateStatus]);

  const handleRevoke = useCallback(async () => {
    if (revoking) return;
    setRevoking(true);
    setError(null);
    try {
      await revokeScopeSandbox(projectId, scope.id);
      setInfo(null);
      await mutateStatus();
    } catch (err) {
      setError((err as Error).message || 'Failed to revoke');
    } finally {
      setRevoking(false);
    }
  }, [revoking, projectId, scope.id, mutateStatus]);

  const statusText = useMemo(() => {
    if (error) return 'Needs attention';
    if (connected) return 'Active';
    if (workspaceStarted) return 'Ready';
    return 'Off';
  }, [connected, error, workspaceStarted]);

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 8,
        border: `1px solid ${
          expanded
            ? 'var(--po-border-strong)'
            : workspaceActive
              ? 'color-mix(in srgb, var(--po-success) 24%, var(--po-border-subtle) 76%)'
              : T.cardBorder
        }`,
        background: expanded
          ? 'color-mix(in srgb, var(--po-panel) 72%, var(--po-control) 28%)'
          : workspaceActive
            ? 'color-mix(in srgb, var(--po-success) 4%, var(--po-canvas) 96%)'
            : workspaceOff
              ? 'color-mix(in srgb, var(--po-canvas) 88%, var(--po-control) 12%)'
              : T.bg,
        overflow: 'hidden',
        boxShadow: expanded ? '0 1px 2px color-mix(in srgb, var(--po-shadow) 16%, transparent)' : 'none',
        transition: `border-color 0.15s ${T.ease}, box-shadow 0.15s ${T.ease}, background 0.15s ${T.ease}`,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-pressed={expanded}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          minHeight: 132,
          minWidth: 0,
          display: 'grid',
          gridTemplateColumns: 'minmax(260px, 1fr) 148px minmax(280px, 320px)',
          alignItems: 'stretch',
          gap: 16,
          padding: '16px 18px',
          boxSizing: 'border-box',
          cursor: 'pointer',
          outline: 'none',
          background: expanded
            ? 'color-mix(in srgb, var(--po-panel) 68%, var(--po-control) 32%)'
            : hovered
              ? workspaceOff
                ? 'color-mix(in srgb, var(--po-canvas) 82%, var(--po-control) 18%)'
                : 'color-mix(in srgb, var(--po-panel) 78%, var(--po-control) 22%)'
              : 'transparent',
          transition: `background 0.15s ${T.ease}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, minWidth: 0, opacity: workspaceOff ? 0.68 : 1 }}>
          <SandboxIconTile visualState={workspaceVisualState} active={expanded || connected} />
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
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
                Remote Workspace
              </span>
              <span aria-hidden style={{ color: T.text4, fontSize: 12 }}>·</span>
              <span
                style={{
                  color: workspaceActive ? 'var(--po-success)' : T.text3,
                  fontSize: 12,
                  lineHeight: '16px',
                  fontFamily: T.fontSans,
                  whiteSpace: 'nowrap',
                }}
              >
                {statusText}
              </span>
            </div>
            <div
              style={{
                fontSize: 12,
                color: T.text2,
                fontFamily: T.fontSans,
                lineHeight: '18px',
                fontWeight: 400,
              }}
            >
              Open this scope's ready Git workspace in Cursor or VS Code.
            </div>
          </div>
        </div>

        <SandboxPreviewActions
          connected={connected}
          loading={!status}
          expanded={expanded}
          visualState={workspaceVisualState}
          onToggle={() => setExpanded((v) => !v)}
        />

        <SandboxCommandPreview
          scope={scope}
          alias={alias}
          command={openCommand}
          connected={connected}
          visualState={workspaceVisualState}
        />
      </div>

      {expanded ? (
        <div
          style={{
            borderTop: `1px solid ${T.cardBorder}`,
            background: 'color-mix(in srgb, var(--po-control) 76%, var(--po-panel) 24%)',
            padding: '14px 16px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {connected ? (
            <ConnectedView
              info={info}
              status={status}
              alias={alias}
              openCommand={openCommand}
              workspacePath={workspacePath}
              onRevoke={handleRevoke}
              revoking={revoking}
            />
          ) : (
            <SandboxSetupForm
              publicKey={publicKey}
              onPublicKeyChange={setPublicKey}
              keyLooksValid={keyLooksValid}
              connecting={connecting}
              connected={connected}
              statusConnected={status?.connected ?? false}
              revoking={revoking}
              onConnect={handleConnect}
              onRevoke={handleRevoke}
            />
          )}

          <AdvancedSettingsSection
            providerList={providerList}
            effectiveProvider={effectiveProvider}
            onProviderChange={setProvider}
            syncPolicy={syncPolicy}
            savingSync={savingSync}
            onSyncUpdate={updateSync}
          />

          {error ? (
            <div style={{ fontSize: 11, color: 'var(--po-danger)', lineHeight: 1.5 }}>{error}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SandboxIconTile({
  active,
  visualState,
}: {
  readonly active: boolean;
  readonly visualState: WorkspaceVisualState;
}) {
  const activated = visualState === 'active';
  const off = visualState === 'off';
  return (
    <div
      style={{
        height: 36,
        width: 36,
        borderRadius: 8,
        background: activated
          ? 'color-mix(in srgb, var(--po-success) 18%, #272b3a 82%)'
          : active
            ? '#272b3a'
            : 'color-mix(in srgb, var(--po-control) 76%, var(--po-canvas) 24%)',
        border: `1px solid ${activated ? 'color-mix(in srgb, var(--po-success) 42%, #555b72 58%)' : active ? '#555b72' : T.cardBorder}`,
        color: activated || active ? '#f4efe5' : T.text2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        opacity: off ? 0.84 : 1,
        boxShadow: activated
          ? '0 1px 4px color-mix(in srgb, var(--po-success) 18%, transparent)'
          : active
            ? '0 1px 3px color-mix(in srgb, var(--po-shadow) 28%, transparent)'
            : 'none',
      }}
    >
      <RemoteWorkspaceGlyph size={22} />
    </div>
  );
}

function SandboxStatusPill({
  loading,
  visualState,
}: {
  readonly loading: boolean;
  readonly visualState: WorkspaceVisualState;
}) {
  const active = visualState === 'active';
  const off = visualState === 'off';
  const label = loading ? 'Checking' : active ? 'Active' : off ? 'Off' : 'Not connected';
  const status = loading ? 'loading' : active ? 'active' : off ? 'inactive' : 'paused';
  return (
    <StatusIndicator
      status={status}
      label={label}
      onClick={(event) => event.stopPropagation()}
      style={{
        justifyContent: 'flex-end',
        minWidth: 0,
      }}
    />
  );
}

function SandboxPreviewActions({
  connected,
  loading,
  expanded,
  visualState,
  onToggle,
}: {
  readonly connected: boolean;
  readonly loading: boolean;
  readonly expanded: boolean;
  readonly visualState: WorkspaceVisualState;
  readonly onToggle: () => void;
}) {
  return (
    <div
      onClick={(event) => event.stopPropagation()}
      style={{
        display: 'flex',
        minWidth: 0,
        alignItems: 'flex-end',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <SandboxStatusPill loading={loading} visualState={visualState} />
      <SandboxActionButton
        label={connected ? 'Open details' : 'Setup workspace'}
        active={expanded}
        quiet={visualState === 'off'}
        onClick={onToggle}
      />
    </div>
  );
}

function SandboxActionButton({
  label,
  active,
  quiet = false,
  onClick,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly quiet?: boolean;
  readonly onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 34,
        minWidth: 132,
        borderRadius: 7,
        border: `1px solid ${active || hovered ? 'var(--po-border-strong)' : T.border}`,
        background: active || hovered
          ? 'color-mix(in srgb, var(--po-panel) 72%, var(--po-control) 28%)'
          : quiet
            ? 'color-mix(in srgb, var(--po-control) 46%, var(--po-panel) 54%)'
            : 'transparent',
        color: active ? T.text1 : T.text2,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '0 12px',
        fontSize: 12,
        lineHeight: '16px',
        fontWeight: 500,
        fontFamily: T.fontSans,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: `background 0.15s ${T.ease}, border-color 0.15s ${T.ease}, color 0.15s ${T.ease}`,
      }}
    >
      <span>{label}</span>
      <ChevronRightGlyph size={11} />
    </button>
  );
}

function SandboxCommandPreview({
  scope,
  alias,
  command,
  connected,
  visualState,
}: {
  readonly scope: RepoScope;
  readonly alias: string;
  readonly command: string;
  readonly connected: boolean;
  readonly visualState: WorkspaceVisualState;
}) {
  const [copied, setCopied] = useState(false);
  const off = visualState === 'off';
  const preview = command
    ? `Open this Puppyone Remote Workspace.\n\nHost: ${alias}\nScope: ${formatScopePath(scope)}\n\n${command}`
    : `Open this Puppyone Remote Workspace.\n\nScope: ${formatScopePath(scope)}\nHost: ${alias}\n\n${connected ? 'Connect again to show the VS Code command.' : 'Paste your SSH public key, then connect.'}`;

  const copyCommand = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  }, [command]);

  return (
    <div
      style={{
        position: 'relative',
        minWidth: 0,
        minHeight: 96,
        borderRadius: 7,
        border: `1px solid ${T.cardBorder}`,
        background: 'color-mix(in srgb, var(--po-inset) 92%, var(--po-panel) 8%)',
        overflow: 'hidden',
        opacity: off ? 0.72 : 1,
      }}
    >
      <pre
        aria-hidden
        style={{
          margin: 0,
          padding: '9px 10px 30px',
          color: 'color-mix(in srgb, var(--po-text) 58%, var(--po-text-muted) 42%)',
          fontFamily: T.fontMono,
          fontSize: 12,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 96,
          overflow: 'hidden',
        }}
      >
        {preview}
      </pre>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, color-mix(in srgb, var(--po-inset) 18%, transparent) 0%, color-mix(in srgb, var(--po-inset) 92%, var(--po-panel) 8%) 82%)',
          pointerEvents: 'none',
        }}
      />
      <AiHandoffButton
        disabled={!command}
        copied={copied}
        label={command ? 'Copy command' : 'Connect first'}
        copiedLabel="Copied"
        onClick={copyCommand}
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      />
    </div>
  );
}

const PUBLISH_TIMING: ReadonlyArray<{ id: SyncPersona; label: string }> = [
  { id: 'non_dev', label: 'Autopilot' },
  { id: 'dev', label: 'On save / tests pass' },
];

function AdvancedSettingsSection({
  providerList,
  effectiveProvider,
  onProviderChange,
  syncPolicy,
  savingSync,
  onSyncUpdate,
}: {
  readonly providerList: readonly { id: SandboxProvider; label: string; configured: boolean }[];
  readonly effectiveProvider: SandboxProvider;
  readonly onProviderChange: (provider: SandboxProvider) => void;
  readonly syncPolicy: SyncPolicyResolved | undefined;
  readonly savingSync: boolean;
  readonly onSyncUpdate: (patch: { persona?: SyncPersona; auto_sync?: boolean }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid ${T.cardBorder}`,
        background: 'var(--po-panel)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          height: 36,
          border: 'none',
          background: 'transparent',
          color: T.text2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          fontFamily: T.fontSans,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <span>Advanced</span>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: `transform 0.15s ${T.ease}`,
          }}
        >
          <ChevronDownGlyph size={10} />
        </span>
      </button>
      {open ? (
        <div
          style={{
            borderTop: `1px solid ${T.cardBorder}`,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div>
            <SubSectionLabel>Provider</SubSectionLabel>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {providerList.map((p) => {
                const active = effectiveProvider === p.id;
                const disabled = !p.configured;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={disabled}
                    title={disabled ? 'Not configured on the server' : undefined}
                    onClick={() => !disabled && onProviderChange(p.id)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      height: 30,
                      padding: '0 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: T.fontSans,
                      color: disabled ? T.text4 : active ? T.text1 : T.text2,
                      background: active
                        ? 'color-mix(in srgb, var(--po-control) 76%, var(--po-panel) 24%)'
                        : 'transparent',
                      border: `1px solid ${active ? 'var(--po-border-strong)' : T.border}`,
                      borderRadius: 999,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.55 : 1,
                    }}
                  >
                    {p.label}
                    {disabled ? (
                      <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.72 }}>not configured</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
          <SyncSettingsSection
            policy={syncPolicy}
            saving={savingSync}
            onUpdate={onSyncUpdate}
            framed={false}
          />
        </div>
      ) : null}
    </div>
  );
}

function SyncSettingsSection({
  policy,
  saving,
  onUpdate,
  framed = true,
}: {
  readonly policy: SyncPolicyResolved | undefined;
  readonly saving: boolean;
  readonly onUpdate: (patch: { persona?: SyncPersona; auto_sync?: boolean }) => Promise<void>;
  readonly framed?: boolean;
}) {
  const autoSync = policy?.auto_sync ?? true;
  const timing: SyncPersona = policy?.persona === 'non_dev' ? 'non_dev' : 'dev';

  return (
    <div
      style={{
        borderRadius: framed ? 8 : 0,
        border: framed ? `1px solid ${T.cardBorder}` : 'none',
        background: framed ? 'var(--po-panel)' : 'transparent',
        padding: framed ? 12 : 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <SubSectionLabel>Remote sync</SubSectionLabel>
        <ToggleSwitch
          checked={autoSync}
          disabled={!policy}
          pending={saving}
          ariaLabel="Remote sync"
          onCheckedChange={(v) => void onUpdate({ auto_sync: v })}
        />
      </div>
      {autoSync ? (
        <div>
          <div style={{ fontSize: 11, color: T.text3, marginBottom: 4 }}>Publish timing</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {PUBLISH_TIMING.map((opt) => {
              const active = timing === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={saving}
                  onClick={() => void onUpdate({ persona: opt.id })}
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    padding: '6px 10px',
                    fontSize: 11,
                    fontFamily: T.fontSans,
                    lineHeight: 1.3,
                    color: active ? T.text1 : T.text2,
                    background: active
                      ? 'color-mix(in srgb, var(--po-control) 74%, var(--po-panel) 26%)'
                      : 'transparent',
                    border: `1px solid ${active ? 'var(--po-border-strong)' : T.border}`,
                    borderRadius: 8,
                    cursor: saving ? 'not-allowed' : 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: T.text3 }}>
        {policy ? describeSyncPolicy(policy) : 'Loading sync policy...'}
      </p>
    </div>
  );
}

function SandboxSetupForm({
  publicKey,
  onPublicKeyChange,
  keyLooksValid,
  connecting,
  connected,
  statusConnected,
  revoking,
  onConnect,
  onRevoke,
}: {
  readonly publicKey: string;
  readonly onPublicKeyChange: (value: string) => void;
  readonly keyLooksValid: boolean;
  readonly connecting: boolean;
  readonly connected: boolean;
  readonly statusConnected: boolean;
  readonly revoking: boolean;
  readonly onConnect: () => void;
  readonly onRevoke: () => void;
}) {
  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid ${T.cardBorder}`,
        background: 'var(--po-panel)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ fontSize: 13, lineHeight: '18px', fontWeight: 600, color: T.text1, fontFamily: T.fontSans }}>
          Connect this sandbox
        </div>
        <div style={{ fontSize: 12, lineHeight: '18px', color: T.text2, fontFamily: T.fontSans }}>
          One-time setup for Cursor or VS Code. Your private key stays on your Mac; Puppyone only needs the public key so this sandbox can recognize your laptop.
        </div>
      </div>

      <SetupStep number={1} title="Copy your public key from Terminal">
        <CommandBlock lines={['cat ~/.ssh/id_ed25519.pub | pbcopy']} />
        <p style={{ margin: '6px 0 0', fontSize: 11, lineHeight: 1.5, color: T.text3 }}>
          Open Terminal on your Mac, paste this command, then press Return. It copies your public key to your clipboard.
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 11, lineHeight: 1.5, color: T.text4 }}>
          If Terminal says the file does not exist, create a key with{' '}
          <code style={{ fontFamily: T.fontMono }}>ssh-keygen -t ed25519</code>, then run the command above again.
        </p>
      </SetupStep>

      <SetupStep number={2} title="Paste it here">
        <textarea
          value={publicKey}
          onChange={(e) => onPublicKeyChange(e.target.value)}
          placeholder="ssh-ed25519 AAAA... you@laptop"
          spellCheck={false}
          rows={3}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            resize: 'vertical',
            padding: '8px 10px',
            fontFamily: T.fontMono,
            fontSize: 12,
            lineHeight: 1.5,
            color: T.text1,
            background: 'var(--po-control)',
            border: `1px solid ${T.border}`,
            borderRadius: 6,
            outline: 'none',
          }}
        />
        {publicKey.trim() && !keyLooksValid ? (
          <p style={{ margin: '6px 0 0', fontSize: 11, lineHeight: 1.5, color: 'var(--po-warning)' }}>
            This does not look like an SSH public key. It should start with{' '}
            <code style={{ fontFamily: T.fontMono }}>ssh-ed25519</code>,{' '}
            <code style={{ fontFamily: T.fontMono }}>ssh-rsa</code>, or{' '}
            <code style={{ fontFamily: T.fontMono }}>ecdsa-sha2-</code>.
          </p>
        ) : (
          <p style={{ margin: '6px 0 0', fontSize: 11, lineHeight: 1.5, color: T.text3 }}>
            Click this field and press <strong>Command+V</strong>. Only the public key is sent.
          </p>
        )}
      </SetupStep>

      <SetupStep number={3} title="Connect the sandbox">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onConnect}
            disabled={!keyLooksValid || connecting}
            style={connectBtnStyle(!keyLooksValid || connecting)}
          >
            {connecting ? 'Connecting...' : connected ? 'Refresh command' : 'Connect'}
          </button>
          <span style={{ fontSize: 11, color: T.text3, fontFamily: T.fontSans }}>
            After Connect, copy the command on the right to open the initialized Git workspace.
          </span>
          {statusConnected ? (
            <button
              type="button"
              onClick={onRevoke}
              disabled={revoking}
              style={revokeBtnStyle(revoking)}
            >
              {revoking ? 'Revoking...' : 'Revoke my access'}
            </button>
          ) : null}
        </div>
      </SetupStep>
    </div>
  );
}

function SetupStep({
  number,
  title,
  children,
}: {
  readonly number: number;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '22px minmax(0, 1fr)',
        gap: 10,
        alignItems: 'start',
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          border: `1px solid ${T.cardBorder}`,
          background: 'color-mix(in srgb, var(--po-control) 70%, var(--po-panel) 30%)',
          color: T.text2,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 600,
          fontFamily: T.fontSans,
        }}
      >
        {number}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ marginBottom: 7, fontSize: 12, color: T.text1, fontWeight: 600, fontFamily: T.fontSans }}>
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}

function ConnectedView({
  info,
  status,
  alias,
  openCommand,
  workspacePath,
  onRevoke,
  revoking,
}: {
  readonly info: SandboxConnectInfo | null;
  readonly status: SandboxStatus | undefined;
  readonly alias: string;
  readonly openCommand: string;
  readonly workspacePath: string;
  readonly onRevoke: () => void;
  readonly revoking: boolean;
}) {
  const provider = info?.provider ?? status?.provider ?? '-';
  const state = info ? `${info.state} (${info.via})` : status?.state ?? '-';
  const host = info?.host ?? status?.host ?? status?.sandbox_id ?? '-';
  const username = info?.username ?? status?.username ?? '-';
  const needsWebsocat = info?.needs_websocat ?? status?.needs_websocat ?? false;
  const sshConfigBlock = info?.ssh_config_block ?? status?.ssh_config_block ?? '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <KvBlock
        rows={[
          { label: 'Provider', value: provider },
          { label: 'State', value: state },
          { label: 'Host', value: host, mono: true, copyable: host !== '-' },
          { label: 'User', value: username, mono: true },
          { label: 'Workspace', value: workspacePath || '-', mono: true, copyable: Boolean(workspacePath) },
          ...(info ? [{ label: 'Expires', value: fmtExpiry(info.expires_at) }] : []),
        ]}
      />

      {needsWebsocat ? (
        <div
          style={{
            borderRadius: 6,
            border: '1px solid color-mix(in srgb, var(--po-warning) 25%, transparent)',
            background: 'color-mix(in srgb, var(--po-warning) 6%, transparent)',
            color: 'var(--po-warning)',
            fontSize: 11,
            lineHeight: 1.5,
            padding: '8px 10px',
          }}
        >
          This provider tunnels SSH over a WebSocket. Install <strong>websocat</strong> and ensure it is on
          your PATH. The ProxyCommand below uses it.
        </div>
      ) : null}

      <div>
        <SubSectionLabel>Add to ~/.ssh/config</SubSectionLabel>
        <CommandBlock
          lines={sshConfigBlock
            ? sshConfigBlock.trimEnd().split('\n')
            : [`Host ${alias}`, '    # Connect again if this config is missing.']}
        />
      </div>

      <div>
        <SubSectionLabel>Open the Git workspace</SubSectionLabel>
        <CommandBlock lines={[openCommand || `code --remote ssh-remote+${alias} ${workspacePath || '<workspace>'}`]} />
        <p style={{ margin: '6px 0 0', fontSize: 11, color: T.text3, fontFamily: T.fontSans }}>
          Use VS Code Remote-SSH and pick <code style={{ fontFamily: T.fontMono }}>{alias}</code>.
          The path opens the cloned Git repo directly.
        </p>
      </div>

      <button type="button" onClick={onRevoke} disabled={revoking} style={revokeBtnStyle(revoking)}>
        {revoking ? 'Revoking...' : 'Revoke my access'}
      </button>
    </div>
  );
}

function connectBtnStyle(disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 32,
    padding: '0 14px',
    fontSize: 12,
    fontWeight: 600,
    fontFamily: T.fontSans,
    color: disabled ? T.text3 : T.text1,
    background: disabled
      ? 'color-mix(in srgb, var(--po-control) 52%, var(--po-panel) 48%)'
      : 'color-mix(in srgb, var(--po-control) 76%, var(--po-panel) 24%)',
    border: `1px solid ${disabled ? T.cardBorder : 'var(--po-border-strong)'}`,
    borderRadius: 999,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.68 : 1,
  };
}

function revokeBtnStyle(disabled: boolean): CSSProperties {
  return {
    alignSelf: 'flex-start',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 30,
    padding: '0 14px',
    fontSize: 12,
    fontWeight: 600,
    fontFamily: T.fontSans,
    color: 'var(--po-danger)',
    background: 'transparent',
    border: '1px solid color-mix(in srgb, var(--po-danger) 35%, transparent)',
    borderRadius: 999,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}

const RemoteWorkspaceGlyph = ({ size = 22 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="5.25" y="7" width="17.5" height="12.25" rx="2.6" opacity="0.96" />
    <path d="M10.1 22h7.8" />
    <path d="M14 19.25V22" />
    <path d="M10.2 14.2c.35-1.55 1.58-2.65 3.08-2.65 1.11 0 2.08.56 2.64 1.42.33-.13.69-.2 1.07-.2 1.37 0 2.48 1.04 2.48 2.31s-1.11 2.31-2.48 2.31h-6.42c-1.09 0-1.98-.76-1.98-1.7 0-.78.65-1.36 1.61-1.49Z" />
  </svg>
);

const ChevronDownGlyph = ({ size = 10 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const ChevronRightGlyph = ({ size = 11 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="9 6 15 12 9 18" />
  </svg>
);
