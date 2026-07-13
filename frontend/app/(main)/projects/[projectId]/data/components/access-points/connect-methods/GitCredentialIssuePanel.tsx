'use client';

import { useCallback, useEffect, useState } from 'react';
import { post } from '@/lib/apiClient';
import { isSameCanonicalGitUrl } from '@/lib/gitRemote';
import { CommandBlock } from './CommandBlock';

const GIT_CREDENTIAL_PATTERN = /^git_[A-Za-z0-9_-]{32,128}$/;

type IssuedGitCredential = {
  credential: string;
  git_url: string;
  git_username: string;
  grant_mode: 'r' | 'rw';
};

export function GitCredentialIssuePanel({
  connectorId,
  gitUrl,
  scopeMode,
}: {
  readonly connectorId: string;
  readonly gitUrl: string;
  readonly scopeMode: 'r' | 'rw';
}) {
  const [issued, setIssued] = useState<IssuedGitCredential | null>(null);
  const [grantMode, setGrantMode] = useState<'r' | 'rw'>(scopeMode);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIssued(null);
    setGrantMode(scopeMode);
    setError(null);
  }, [connectorId, gitUrl, scopeMode]);

  const issue = useCallback(async () => {
    if (!connectorId || issuing) return;
    setIssuing(true);
    setError(null);
    try {
      const result = await post<IssuedGitCredential>(
        `/api/v1/access/${encodeURIComponent(connectorId)}/regenerate-key`,
        { grant_mode: grantMode },
      );
      if (
        !GIT_CREDENTIAL_PATTERN.test(result.credential?.trim() || '')
        || result.git_username !== 'x-puppyone-token'
        || result.grant_mode !== grantMode
        || !isSameCanonicalGitUrl(gitUrl, result.git_url)
      ) {
        throw new Error('Cloud returned an invalid Git credential contract');
      }
      setIssued(result);
    } catch (caught) {
      setIssued(null);
      setError(caught instanceof Error ? caught.message : 'Unable to issue Git credential');
    } finally {
      setIssuing(false);
    }
  }, [connectorId, gitUrl, grantMode, issuing]);

  const locator = issued?.git_url || gitUrl;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <select
          aria-label='Git credential permission'
          value={grantMode}
          disabled={issuing}
          onChange={(event) => {
            setGrantMode(event.target.value === 'r' ? 'r' : 'rw');
            setIssued(null);
          }}
          style={{
            minHeight: 30,
            padding: '0 8px',
            border: '1px solid var(--po-border)',
            borderRadius: 6,
            background: 'var(--po-panel)',
            color: 'var(--po-text)',
            fontSize: 12,
          }}
        >
          <option value='rw' disabled={scopeMode !== 'rw'}>Read &amp; write</option>
          <option value='r'>Read only</option>
        </select>
        <button
          type='button'
          onClick={() => void issue()}
          disabled={!connectorId || issuing}
          style={{
            minHeight: 30,
            padding: '0 10px',
            border: '1px solid var(--po-border)',
            borderRadius: 6,
            background: 'var(--po-panel)',
            color: 'var(--po-text)',
            cursor: !connectorId || issuing ? 'not-allowed' : 'pointer',
            fontSize: 12,
            opacity: connectorId ? 1 : 0.55,
          }}
        >
          {issuing ? 'Generating…' : issued ? 'Rotate this permission' : 'Generate Git credential'}
        </button>
      </div>
      {issued ? (
        <>
          <CommandBlock lines={[
            `Git URL: ${locator}`,
            `Permission: ${issued.grant_mode === 'rw' ? 'read & write' : 'read only'}`,
            `Username: ${issued.git_username}`,
            `Password: ${issued.credential}`,
          ]} />
          <span style={{ color: 'var(--po-text-subtle)', fontSize: 11 }}>
            Save this password now. It is shown only once and never belongs in the Git URL.
            Rotating this permission does not revoke the other permission.
          </span>
        </>
      ) : null}
      {error ? <span style={{ color: 'var(--po-danger)', fontSize: 11 }}>{error}</span> : null}
    </div>
  );
}
