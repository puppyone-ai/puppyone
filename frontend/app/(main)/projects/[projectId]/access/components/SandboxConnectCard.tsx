'use client';

/**
 * Remote Dev (SSH) — scope-level card in the Access detail panel.
 *
 * The "sandbox as access point" surface: a scope-keyed dev box the user reaches
 * via VSCode Remote-SSH. Unlike the connector surfaces (git_remote/cli/…), this
 * isn't an access_surfaces row — it's a runtime session keyed by the scope, so
 * it lives as its own card rather than inside ConnectorList.
 *
 * Flow: pick provider → paste your SSH public key → Connect. The server
 * acquires/reuses the scope's sandbox, clones the scope inside it, and grants a
 * short-lived, revocable key. We then show the ready-to-paste ~/.ssh/config
 * block + a Revoke button. See lib/scopeSandboxApi.ts + the backend router.
 */

import { useCallback, useState } from 'react';
import useSWR from 'swr';
import type { RepoScope } from '@/lib/repoApi';
import {
  connectScopeSandbox,
  getScopeSandboxStatus,
  revokeScopeSandbox,
  type SandboxConnectInfo,
  type SandboxProvider,
} from '@/lib/scopeSandboxApi';
import { T } from '../lib/tokens';
import { CommandBlock, KvBlock, SectionLabel, SubSectionLabel } from './ui-blocks';

const PROVIDERS: ReadonlyArray<{ id: SandboxProvider; label: string; note?: string }> = [
  { id: 'e2b', label: 'E2B' },
  { id: 'fly', label: 'Fly', note: 'needs setup' },
];

function fmtExpiry(epoch: number): string {
  try {
    return new Date(epoch * 1000).toLocaleString();
  } catch {
    return '—';
  }
}

export function SandboxConnectCard({
  scope,
  projectId,
}: {
  readonly scope: RepoScope;
  readonly projectId: string;
}) {
  const [provider, setProvider] = useState<SandboxProvider>('e2b');
  const [publicKey, setPublicKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<SandboxConnectInfo | null>(null);
  const [revoking, setRevoking] = useState(false);

  const { data: status, mutate: mutateStatus } = useSWR(
    projectId && scope.id ? ['scope-sandbox-status', projectId, scope.id] : null,
    () => getScopeSandboxStatus(projectId, scope.id),
    { refreshInterval: 20000, revalidateOnFocus: false },
  );

  const keyLooksValid = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-)\s+\S+/.test(publicKey.trim());

  const handleConnect = useCallback(async () => {
    if (connecting || !keyLooksValid) return;
    setConnecting(true);
    setError(null);
    try {
      const result = await connectScopeSandbox({
        projectId,
        scopeId: scope.id,
        publicKey: publicKey.trim(),
        provider,
      });
      setInfo(result);
      await mutateStatus();
    } catch (err) {
      setError((err as Error).message || 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  }, [connecting, keyLooksValid, projectId, scope.id, publicKey, provider, mutateStatus]);

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

  const connected = info != null || (status?.connected ?? false);

  return (
    <div style={{ marginTop: 26 }}>
      <SectionLabel
        right={
          status && status.state !== 'none' ? (
            <span style={{ fontSize: 12, color: T.text4, fontFamily: T.fontSans, fontWeight: 500 }}>
              {status.state}
              {status.connected_users ? ` · ${status.connected_users} connected` : ''}
            </span>
          ) : null
        }
      >
        Remote Dev (SSH)
      </SectionLabel>

      <div
        style={{
          borderRadius: 8,
          border: `1px solid ${T.cardBorder}`,
          background: T.cardBg,
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          fontFamily: T.fontSans,
        }}
      >
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: T.text2 }}>
          Open this scope in a cloud dev box over VSCode Remote-SSH. The scope is cloned inside;
          all git/CLI runs server-side. Your key is short-lived and revocable.
        </p>

        {info ? (
          <ConnectedView info={info} scopeId={scope.id} onRevoke={handleRevoke} revoking={revoking} />
        ) : (
          <>
            {/* Provider selector */}
            <div>
              <SubSectionLabel>Provider</SubSectionLabel>
              <div style={{ display: 'flex', gap: 6 }}>
                {PROVIDERS.map((p) => {
                  const active = provider === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setProvider(p.id)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        height: 30,
                        padding: '0 12px',
                        fontSize: 12,
                        fontWeight: 600,
                        fontFamily: T.fontSans,
                        color: active ? 'var(--po-text-inverse)' : T.text2,
                        background: active ? 'var(--po-text)' : 'transparent',
                        border: `1px solid ${active ? 'var(--po-text)' : T.border}`,
                        borderRadius: 999,
                        cursor: 'pointer',
                      }}
                    >
                      {p.label}
                      {p.note ? (
                        <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.7 }}>· {p.note}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Public key */}
            <div>
              <SubSectionLabel>Your SSH public key</SubSectionLabel>
              <textarea
                value={publicKey}
                onChange={(e) => setPublicKey(e.target.value)}
                placeholder="ssh-ed25519 AAAA… you@laptop   (paste your PUBLIC key, e.g. ~/.ssh/id_ed25519.pub)"
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
              <p style={{ margin: '6px 0 0', fontSize: 11, color: T.text3 }}>
                Get it with <code style={{ fontFamily: T.fontMono }}>cat ~/.ssh/id_ed25519.pub</code>{' '}
                (or generate: <code style={{ fontFamily: T.fontMono }}>ssh-keygen -t ed25519</code>). The private key never leaves your machine.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                onClick={handleConnect}
                disabled={!keyLooksValid || connecting}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: 32,
                  padding: '0 16px',
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: T.fontSans,
                  color: !keyLooksValid || connecting ? T.text3 : 'var(--po-text-inverse)',
                  background: !keyLooksValid || connecting ? 'var(--po-border-subtle)' : 'var(--po-text)',
                  border: 'none',
                  borderRadius: 999,
                  cursor: !keyLooksValid || connecting ? 'not-allowed' : 'pointer',
                }}
              >
                {connecting ? 'Connecting…' : 'Connect'}
              </button>
              {connected && status?.connected ? (
                <button
                  type="button"
                  onClick={handleRevoke}
                  disabled={revoking}
                  style={revokeBtnStyle(revoking)}
                >
                  {revoking ? 'Revoking…' : 'Revoke my access'}
                </button>
              ) : null}
            </div>
          </>
        )}

        {error ? (
          <div style={{ fontSize: 11, color: 'var(--po-danger)', lineHeight: 1.5 }}>{error}</div>
        ) : null}
      </div>
    </div>
  );
}

function ConnectedView({
  info,
  scopeId,
  onRevoke,
  revoking,
}: {
  readonly info: SandboxConnectInfo;
  readonly scopeId: string;
  readonly onRevoke: () => void;
  readonly revoking: boolean;
}) {
  const alias = `puppy-${scopeId.slice(0, 8)}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <KvBlock
        rows={[
          { label: 'Provider', value: info.provider },
          { label: 'State', value: `${info.state} (${info.via})` },
          { label: 'Host', value: info.host, mono: true, copyable: true },
          { label: 'User', value: info.username, mono: true },
          { label: 'Expires', value: fmtExpiry(info.expires_at) },
        ]}
      />

      {info.needs_websocat ? (
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
          This provider tunnels SSH over a WebSocket. Install <strong>websocat</strong> and ensure it’s on
          your PATH (the ProxyCommand below uses it). See{' '}
          <code style={{ fontFamily: T.fontMono }}>github.com/vi/websocat</code>.
        </div>
      ) : null}

      <div>
        <SubSectionLabel>Add to ~/.ssh/config</SubSectionLabel>
        <CommandBlock lines={info.ssh_config_block.trimEnd().split('\n')} />
      </div>

      <div>
        <SubSectionLabel>Then open in VS Code</SubSectionLabel>
        <CommandBlock lines={[`code --remote ssh-remote+${alias} /home/${info.username}`]} />
        <p style={{ margin: '6px 0 0', fontSize: 11, color: T.text3, fontFamily: T.fontSans }}>
          Or use the VS Code “Remote-SSH: Connect to Host…” command and pick{' '}
          <code style={{ fontFamily: T.fontMono }}>{alias}</code>. Replace the IdentityFile with the path to your private key.
        </p>
      </div>

      <button type="button" onClick={onRevoke} disabled={revoking} style={revokeBtnStyle(revoking)}>
        {revoking ? 'Revoking…' : 'Revoke my access'}
      </button>
    </div>
  );
}

function revokeBtnStyle(disabled: boolean): React.CSSProperties {
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
