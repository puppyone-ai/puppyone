'use client';

/**
 * Form to bind a project to a GitHub repo. Renders only when the user
 * has a GitHub OAuth connection but no project↔repo binding yet.
 *
 * Flow:
 *   1. List the OAuth user's repos via ``listGithubRepos``.
 *   2. User picks one — the picker prefills the binding's
 *      ``default_branch`` from the repo's GitHub default.
 *   3. Optionally toggle ``auto_import`` (requires a webhook secret).
 *   4. Submit → ``connectGithubRepo``; bubble the new status up so
 *      the parent can swap to the bound view.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  connectGithubRepo,
  listGithubRepos,
  type GithubIntegrationStatus,
  type GithubRepoSummary,
} from '@/lib/githubIntegrationApi';
import { T } from '../tokens';

interface Props {
  projectId: string;
  oauthConnectionId: number;
  defaultBranch?: string;
  onConnected: (status: GithubIntegrationStatus) => void;
}

export function GithubConnectForm({
  projectId,
  oauthConnectionId,
  defaultBranch = 'main',
  onConnected,
}: Readonly<Props>) {
  const t = useTranslations('integrations.github');

  const [repos, setRepos] = useState<GithubRepoSummary[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const [selectedFullName, setSelectedFullName] = useState<string>('');
  const [branch, setBranch] = useState(defaultBranch);
  const [autoImport, setAutoImport] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRepos(null);
    setReposError(null);
    listGithubRepos(projectId, oauthConnectionId)
      .then((res) => {
        if (cancelled) return;
        setRepos(res.repos);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setReposError(err.message || t('errorGeneric'));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, oauthConnectionId, t]);

  const selectedRepo = useMemo(
    () => repos?.find((r) => r.full_name === selectedFullName) ?? null,
    [repos, selectedFullName],
  );

  // When the user picks a repo, snap ``branch`` to that repo's GitHub
  // default unless they've already typed a custom value.
  useEffect(() => {
    if (selectedRepo && (branch === '' || branch === defaultBranch)) {
      setBranch(selectedRepo.default_branch);
    }
    // Intentionally skip ``branch`` from the dep list — we only want
    // to snap on repo change, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepo, defaultBranch]);

  const filteredRepos = useMemo(() => {
    if (!repos) return [];
    if (!filter.trim()) return repos;
    const q = filter.toLowerCase();
    return repos.filter((r) => r.full_name.toLowerCase().includes(q));
  }, [repos, filter]);

  const canSubmit =
    !submitting &&
    selectedRepo !== null &&
    branch.trim().length > 0 &&
    (!autoImport || webhookSecret.trim().length > 0);

  async function handleSubmit() {
    if (!selectedRepo) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const status = await connectGithubRepo(projectId, {
        oauth_connection_id: oauthConnectionId,
        github_repo_owner: selectedRepo.owner,
        github_repo_name: selectedRepo.name,
        default_branch: branch.trim(),
        auto_import: autoImport,
        webhook_secret: autoImport ? webhookSecret.trim() : null,
      });
      onConnected(status);
    } catch (err) {
      setSubmitError((err as Error).message || t('errorGeneric'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <RepoPicker
        repos={filteredRepos}
        loading={repos === null && reposError === null}
        error={reposError}
        filter={filter}
        onFilterChange={setFilter}
        selectedFullName={selectedFullName}
        onSelect={setSelectedFullName}
        emptyLabel={t('noRepos')}
        loadingLabel={t('loadingRepos')}
      />

      <FieldRow label={t('branch')}>
        <input
          type="text"
          value={branch}
          placeholder={t('branchPlaceholder')}
          onChange={(e) => setBranch(e.target.value)}
          style={{
            background: 'transparent',
            border: `1px solid ${T.cardBorder}`,
            borderRadius: 6,
            color: T.text1,
            fontFamily: T.fontMono,
            fontSize: 13,
            padding: '6px 10px',
            width: 240,
            outline: 'none',
          }}
        />
      </FieldRow>

      <FieldRow label={t('autoImport')}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: T.text2, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={autoImport}
            onChange={(e) => setAutoImport(e.target.checked)}
          />
          <span>{t('autoImportHint')}</span>
        </label>
      </FieldRow>

      {autoImport && (
        <FieldRow label={t('webhookSecret')}>
          <input
            type="text"
            value={webhookSecret}
            placeholder="••••••"
            onChange={(e) => setWebhookSecret(e.target.value)}
            style={{
              background: 'transparent',
              border: `1px solid ${T.cardBorder}`,
              borderRadius: 6,
              color: T.text1,
              fontFamily: T.fontMono,
              fontSize: 13,
              padding: '6px 10px',
              width: 320,
              outline: 'none',
            }}
          />
          <span style={{ color: T.text3, fontSize: 11, marginTop: 4 }}>
            {t('webhookSecretHint')}
          </span>
        </FieldRow>
      )}

      {submitError && (
        <div style={{ color: T.danger, fontSize: 12 }}>{submitError}</div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          style={{
            background: canSubmit ? T.accent : 'rgba(255,255,255,0.04)',
            border: 'none',
            borderRadius: 6,
            color: canSubmit ? '#fff' : T.text3,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            fontFamily: T.fontSans,
            fontSize: 13,
            fontWeight: 500,
            padding: '7px 14px',
            transition: `all 120ms ${T.ease}`,
          }}
        >
          {submitting ? '…' : t('connect')}
        </button>
      </div>
    </div>
  );
}

function FieldRow({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ color: T.text2, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {label}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>
    </div>
  );
}

interface RepoPickerProps {
  repos: GithubRepoSummary[];
  loading: boolean;
  error: string | null;
  filter: string;
  onFilterChange: (v: string) => void;
  selectedFullName: string;
  onSelect: (fullName: string) => void;
  emptyLabel: string;
  loadingLabel: string;
}

function RepoPicker({
  repos,
  loading,
  error,
  filter,
  onFilterChange,
  selectedFullName,
  onSelect,
  emptyLabel,
  loadingLabel,
}: Readonly<RepoPickerProps>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        type="text"
        value={filter}
        placeholder="filter…"
        onChange={(e) => onFilterChange(e.target.value)}
        style={{
          background: 'transparent',
          border: `1px solid ${T.cardBorder}`,
          borderRadius: 6,
          color: T.text1,
          fontFamily: T.fontMono,
          fontSize: 12,
          padding: '6px 10px',
          width: 280,
          outline: 'none',
        }}
      />
      <div
        style={{
          maxHeight: 320,
          overflowY: 'auto',
          border: `1px solid ${T.cardBorder}`,
          borderRadius: 6,
          background: T.cardBg,
        }}
      >
        {loading && (
          <div style={{ padding: 12, color: T.text2, fontSize: 12 }}>{loadingLabel}</div>
        )}
        {error && (
          <div style={{ padding: 12, color: T.danger, fontSize: 12 }}>{error}</div>
        )}
        {!loading && !error && repos.length === 0 && (
          <div style={{ padding: 12, color: T.text3, fontSize: 12 }}>{emptyLabel}</div>
        )}
        {repos.map((r) => {
          const selected = r.full_name === selectedFullName;
          return (
            <button
              type="button"
              key={r.full_name}
              onClick={() => onSelect(r.full_name)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '8px 12px',
                background: selected ? 'rgba(59,130,246,0.1)' : 'transparent',
                border: 'none',
                borderBottom: `1px solid ${T.cardBorder}`,
                color: T.text1,
                fontFamily: T.fontMono,
                fontSize: 12,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span>{r.full_name}</span>
              <span style={{ color: T.text3, fontSize: 10 }}>
                {r.private ? 'private' : 'public'} · {r.default_branch}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
