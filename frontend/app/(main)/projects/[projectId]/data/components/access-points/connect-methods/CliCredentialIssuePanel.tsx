'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { regenerateScopeKey } from '@/lib/repoApi';
import { CommandBlock } from './CommandBlock';

const CLI_CREDENTIAL_PATTERN = /^cli_[A-Za-z0-9_-]{32,128}$/;

function acceptedCliCredential(value: string | null | undefined): string | null {
  const candidate = value?.trim() || '';
  return CLI_CREDENTIAL_PATTERN.test(candidate) ? candidate : null;
}

export function CliCredentialIssuePanel({
  projectId,
  scopeId,
  initialCredential = '',
  children,
}: {
  readonly projectId: string;
  readonly scopeId: string;
  /** A create response may carry a one-time key. Ordinary reads never do. */
  readonly initialCredential?: string;
  readonly children?: (credential: string) => ReactNode;
}) {
  const [issuedCredential, setIssuedCredential] = useState<string | null>(
    acceptedCliCredential(initialCredential),
  );
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Never promote a dashboard mask or legacy preview into a runnable key.
    setIssuedCredential(acceptedCliCredential(initialCredential));
    setError(null);
  }, [projectId, scopeId, initialCredential]);

  const issue = useCallback(async () => {
    if (!projectId || !scopeId || issuing) return;
    setIssuing(true);
    setError(null);
    try {
      const result = await regenerateScopeKey(projectId, scopeId);
      const credential = acceptedCliCredential(result.access_key);
      if (
        result.project_id !== projectId
        || result.id !== scopeId
        || !credential
      ) {
        throw new Error('Cloud returned an invalid one-time CLI credential');
      }
      setIssuedCredential(credential);
    } catch (caught) {
      setIssuedCredential(null);
      setError(caught instanceof Error ? caught.message : 'Unable to generate CLI key');
    } finally {
      setIssuing(false);
    }
  }, [issuing, projectId, scopeId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <button
          type='button'
          onClick={() => void issue()}
          disabled={!projectId || !scopeId || issuing}
          style={{
            minHeight: 30,
            padding: '0 10px',
            border: '1px solid var(--po-border)',
            borderRadius: 6,
            background: 'var(--po-panel)',
            color: 'var(--po-text)',
            cursor: !projectId || !scopeId || issuing ? 'not-allowed' : 'pointer',
            fontSize: 12,
          }}
        >
          {issuing ? 'Generating…' : issuedCredential ? 'Rotate CLI key' : 'Generate new CLI key'}
        </button>
        <span style={{ color: 'var(--po-text-subtle)', fontSize: 11 }}>
          Generating a key revokes the previous CLI key and legacy key-in-URL access.
        </span>
      </div>

      {issuedCredential ? (
        <>
          <CommandBlock lines={[`CLI key: ${issuedCredential}`]} />
          <span style={{ color: 'var(--po-text-subtle)', fontSize: 11 }}>
            Save this key now. It is shown only once, kept only in this page, and is separate from Git credentials.
          </span>
          {children?.(issuedCredential)}
        </>
      ) : (
        <span style={{ color: 'var(--po-text-subtle)', fontSize: 11 }}>
          Existing keys cannot be recovered from ordinary Scope reads. Generate a new one when you need CLI setup.
        </span>
      )}

      {error ? <span style={{ color: 'var(--po-danger)', fontSize: 11 }}>{error}</span> : null}
    </div>
  );
}
