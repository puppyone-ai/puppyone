'use client';

/**
 * GithubIntegrationPanel — the project-level GitHub binding UI,
 * mounted inline inside the "New access → GitHub" flow.
 *
 * This is the same flow the now-deleted ``/projects/{id}/integrations``
 * top-level page used to drive; that route was removed in favour of
 * consolidating the GitHub binding under the same scope-level connector
 * picker that hosts Notion / Gmail / Google Docs / etc., per the
 * 2026-05-10 UX consolidation.
 *
 * The binding itself is still **project-level** — it's not actually
 * scoped to whichever folder the user opened the picker from. We
 * surface that with a one-line note so the mismatch isn't hidden.
 *
 * Three states, decided by SWR-fetched status:
 *
 *   1. No GitHub OAuth account     → "Connect GitHub account" CTA.
 *   2. OAuth account, no binding   → repo picker + branch + connect.
 *   3. Bound                       → status / manual sync / sync log.
 *
 * Subscribes to ``commit_update`` events so import/export results from
 * other clients (or webhook-driven imports) refresh the sync log live.
 */

import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import {
  getGithubBinding,
  type GithubIntegrationStatus,
} from '@/lib/githubIntegrationApi';
import {
  getGithubStatus as getOauthGithubStatus,
  connectGithub as startGithubOAuth,
  type OAuthStatusResponse,
} from '@/lib/oauthApi';
import { useCommitUpdates } from '@/contexts/VersionWebSocketContext';
import { GithubBoundPanel } from './GithubBoundPanel';
import { GithubConnectForm } from './GithubConnectForm';
import { SyncLogTable } from './SyncLogTable';
import { T } from './tokens';

interface Props {
  projectId: string;
}

export function GithubIntegrationPanel({ projectId }: Readonly<Props>) {
  const t = useTranslations('integrations');

  const { data: oauthStatus, isLoading: oauthLoading } = useSWR<OAuthStatusResponse>(
    'oauth-github-status',
    () => getOauthGithubStatus(),
    { revalidateOnFocus: false },
  );

  const {
    data: binding,
    isLoading: bindingLoading,
    mutate: mutateBinding,
  } = useSWR<GithubIntegrationStatus | null>(
    projectId ? ['github-binding', projectId] : null,
    () => getGithubBinding(projectId),
    { revalidateOnFocus: false },
  );

  const [syncLogRefreshKey, setSyncLogRefreshKey] = useState(0);
  const onCommitUpdate = useCallback(() => {
    setSyncLogRefreshKey((k) => k + 1);
    void mutateBinding();
  }, [mutateBinding]);
  useCommitUpdates(onCommitUpdate);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '4px 4px 16px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ color: T.text2, fontSize: 12, lineHeight: 1.5 }}>
          {t('github.description')}
        </span>
        <span style={{ color: T.text3, fontSize: 11, lineHeight: 1.5 }}>
          {t('github.scopeNote')}
        </span>
      </div>

      <GithubBody
        projectId={projectId}
        oauthStatus={oauthStatus}
        oauthLoading={oauthLoading}
        binding={binding ?? null}
        bindingLoading={bindingLoading}
        onBindingChanged={(next) => {
          void mutateBinding(next ?? null, { revalidate: false });
        }}
        onSyncRun={() => {
          void mutateBinding();
          setSyncLogRefreshKey((k) => k + 1);
        }}
      />

      {binding && <SyncLogTable projectId={projectId} refreshKey={syncLogRefreshKey} />}
    </div>
  );
}

interface GithubBodyProps {
  projectId: string;
  oauthStatus?: OAuthStatusResponse;
  oauthLoading: boolean;
  binding: GithubIntegrationStatus | null;
  bindingLoading: boolean;
  onBindingChanged: (next: GithubIntegrationStatus | null) => void;
  onSyncRun: () => void;
}

function GithubBody({
  projectId,
  oauthStatus,
  oauthLoading,
  binding,
  bindingLoading,
  onBindingChanged,
  onSyncRun,
}: Readonly<GithubBodyProps>) {
  const t = useTranslations('integrations.github');
  const [oauthStarting, setOauthStarting] = useState(false);

  if (oauthLoading || bindingLoading) {
    return <Hint>…</Hint>;
  }

  if (binding) {
    return (
      <GithubBoundPanel
        projectId={projectId}
        status={binding}
        onChanged={onBindingChanged}
        onSyncRun={() => onSyncRun()}
      />
    );
  }

  if (!oauthStatus?.connected || oauthStatus.connection_id == null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
        <Hint>{t('notConnectedAccount')}</Hint>
        <button
          type="button"
          disabled={oauthStarting}
          onClick={async () => {
            setOauthStarting(true);
            try {
              await startGithubOAuth();
            } catch {
              setOauthStarting(false);
            }
          }}
          style={{
            background: T.accent,
            border: 'none',
            borderRadius: 6,
            color: 'var(--po-text-inverse)',
            cursor: oauthStarting ? 'not-allowed' : 'pointer',
            fontFamily: T.fontSans,
            fontSize: 13,
            fontWeight: 500,
            height: 30,
            padding: '0 14px',
            opacity: oauthStarting ? 0.5 : 1,
          }}
        >
          {t('connectAccount')}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Hint>
        {t('connectedAs', { username: oauthStatus.username || oauthStatus.workspace_name || '?' })}
      </Hint>
      <GithubConnectForm
        projectId={projectId}
        oauthConnectionId={oauthStatus.connection_id}
        onConnected={(status) => onBindingChanged(status)}
      />
    </div>
  );
}

function Hint({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <span style={{ color: T.text3, fontSize: 12 }}>{children}</span>
  );
}
