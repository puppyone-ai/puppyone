'use client';

/**
 * Integrations page.
 *
 * Three states based on (a) GitHub OAuth account status and
 * (b) project↔repo binding status:
 *
 *   1. **No OAuth**:        prompt to connect a GitHub account.
 *   2. **OAuth, no binding**: render the connect form.
 *   3. **Bound**:             render the status / sync / log panels.
 *
 * The page also subscribes to ``commit_update`` events. Whenever a
 * commit lands (manual or webhook-driven), the sync log gets bumped so
 * the user sees fresh entries immediately.
 */

import { use, useCallback, useState } from 'react';
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
import { useCommitUpdates } from '@/contexts/MutWebSocketContext';
import { GithubBoundPanel } from './components/GithubBoundPanel';
import { GithubConnectForm } from './components/GithubConnectForm';
import { SyncLogTable } from './components/SyncLogTable';
import { T } from './tokens';

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default function IntegrationsPage({ params }: Readonly<PageProps>) {
  const { projectId } = use(params);
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

  // Bump the sync log whenever commits land. Manual import/export
  // already mutate the binding (via ``onSyncRun``), so we additionally
  // catch webhook-driven imports the user didn't trigger.
  const [syncLogRefreshKey, setSyncLogRefreshKey] = useState(0);
  const onCommitUpdate = useCallback(() => {
    setSyncLogRefreshKey((k) => k + 1);
    void mutateBinding();
  }, [mutateBinding]);
  useCommitUpdates(onCommitUpdate);

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        height: '100%',
        overflowY: 'auto',
        background: T.bg,
        color: T.text1,
        fontFamily: T.fontSans,
        padding: '32px 40px',
      }}
    >
      <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32 }}>
        <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>{t('title')}</h1>
          <p style={{ color: T.text2, fontSize: 13, margin: 0, lineHeight: 1.5 }}>
            {t('subtitle')}
          </p>
        </header>

        <Section title={t('github.heading')} description={t('github.description')}>
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
        </Section>

        {binding && (
          <Section title="">
            <SyncLogTable projectId={projectId} refreshKey={syncLogRefreshKey} />
          </Section>
        )}
      </div>
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

/**
 * Decide which of the three states to render. Pulled out into its own
 * component so the page-level ``useCommitUpdates`` is the only effect
 * registered on the parent.
 */
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
        onSyncRun={() => {
          onSyncRun();
        }}
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
            color: '#fff',
            cursor: oauthStarting ? 'not-allowed' : 'pointer',
            fontFamily: T.fontSans,
            fontSize: 13,
            fontWeight: 500,
            padding: '7px 14px',
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

function Section({
  title,
  description,
  children,
}: Readonly<{
  title: string;
  description?: string;
  children: React.ReactNode;
}>) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {title && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 style={{ fontSize: 15, fontWeight: 500, margin: 0, color: T.text1 }}>
            {title}
          </h2>
          {description && (
            <p style={{ color: T.text2, fontSize: 12, margin: 0, lineHeight: 1.5 }}>
              {description}
            </p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

function Hint({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <span style={{ color: T.text3, fontSize: 12 }}>{children}</span>
  );
}
