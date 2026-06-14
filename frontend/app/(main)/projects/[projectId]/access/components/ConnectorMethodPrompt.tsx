'use client';

import { useCallback, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { AiHandoffButton } from '@/components/ui/AiHandoffButton';
import { buildGitSyncPrompt, buildTerminalCliPrompt } from '@/lib/accessPointCliPrompt';
import type { Connector, RepoScope } from '@/lib/repoApi';
import { getAccessProviderPromptKind } from '@/lib/accessProviderRegistry';
import { T } from '../lib/tokens';
import { getApiBase, profileSlug } from '../lib/format';

export function ConnectorMethodPrompt({
  connector,
  scope,
}: {
  readonly connector: Connector;
  readonly scope: RepoScope | undefined;
}) {
  const prompt = useConnectorSetupPrompt(connector, scope);
  return <MethodPromptPreview prompt={prompt} />;
}

export function ConnectorMethodCopyButton({
  connector,
  scope,
  style,
}: {
  readonly connector: Connector;
  readonly scope: RepoScope | undefined;
  readonly style?: CSSProperties;
}) {
  const prompt = useConnectorSetupPrompt(connector, scope);
  return <PromptCopyButton prompt={prompt} style={style} />;
}

function useConnectorSetupPrompt(connector: Connector, scope: RepoScope | undefined): string {
  return useMemo(
    () => buildConnectorSetupPrompt(connector, scope),
    [connector, scope],
  );
}

function MethodPromptPreview({ prompt }: { readonly prompt: string }) {
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
        {prompt || 'Access setup is preparing.'}
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
      <PromptCopyButton
        prompt={prompt}
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

function PromptCopyButton({
  prompt,
  style,
}: {
  readonly prompt: string;
  readonly style?: CSSProperties;
}) {
  const [copied, setCopied] = useState(false);

  const copyPrompt = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  }, [prompt]);

  return (
    <AiHandoffButton
      disabled={!prompt}
      onClick={copyPrompt}
      copied={copied}
      style={style}
    />
  );
}

function buildConnectorSetupPrompt(connector: Connector, scope: RepoScope | undefined): string {
  if (!scope) return '';
  const apiBase = getApiBase();
  const scopeName = scope.name || (scope.path === '' ? 'root' : scope.path || 'Root');
  const accessKey = scope.access_key || connector.access_key || '';
  const promptKind = getAccessProviderPromptKind(connector.provider);
  if (promptKind === 'git_remote') {
    const gitUrl = `${apiBase}/git/ap/${accessKey || '<access-key>'}.git`;
    return buildGitSyncPrompt({
      gitUrl,
      scopeName,
      directoryName: scopeName,
    }).prompt;
  }
  if (promptKind === 'terminal_cli') {
    return buildTerminalCliPrompt({
      apiBase,
      accessKey,
      profileName: profileSlug(scope.name || scope.path || 'root'),
      scopeName,
    }).prompt;
  }
  return '';
}
