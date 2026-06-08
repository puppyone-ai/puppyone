'use client';

import { use, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Plus } from 'lucide-react';
import { ProjectPageLoadingShell } from '@/components/loading';
import { openOAuthPopup, type SaasType } from '@/lib/oauthApi';
import {
  createWorkflow,
  deleteWorkflowConnection,
  getWorkflowProviderSpecs,
  getWorkflowStatus,
  listWorkflowConnections,
  listWorkflowFailedRuns,
  pauseWorkflowConnection,
  refreshWorkflowConnection,
  resumeWorkflowConnection,
  updateWorkflowTrigger,
  type WorkflowFailedRunRow,
  type WorkflowProviderSpec,
} from '@/lib/workflowApi';
import { WorkflowDetail } from './components/WorkflowDetail';
import styles from './components/WorkflowPage.module.css';
import { WorkflowSidebar } from './components/WorkflowSidebar';
import {
  cleanConfig,
  defaultConfigForProvider,
  formatDate,
  providerOAuthKey,
  targetDefault,
  triggerFromStatus,
  workflowName,
  type BusyAction,
  type DetailMode,
  type RecentRun,
  type TriggerMode,
} from './components/workflowHelpers';

const OAUTH_MAP: Partial<Record<string, SaasType>> = {
  github: 'github',
  gmail: 'gmail',
  google_calendar: 'google_calendar',
  calendar: 'google_calendar',
  google_docs: 'google_docs',
  docs: 'google_docs',
  google_sheets: 'google_sheets',
  sheets: 'google_sheets',
  google_drive: 'google_drive',
  drive: 'google_drive',
  google_search_console: 'google_search_console',
};

type WorkflowPageProps = {
  params: Promise<{ projectId: string }>;
};

export default function ProjectWorkflowsPage({ params }: WorkflowPageProps) {
  const { projectId } = use(params);
  const [mode, setMode] = useState<DetailMode>('detail');
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [targetPath, setTargetPath] = useState('');
  const [triggerMode, setTriggerMode] = useState<TriggerMode>('manual');
  const [schedule, setSchedule] = useState('0 9 * * *');
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );
  const [matchStrategy, setMatchStrategy] = useState('id');
  const [changePolicy, setChangePolicy] = useState('changed_rows');
  const [deletePolicy, setDeletePolicy] = useState('keep_deleted');
  const [targetOutput, setTargetOutput] = useState('files_rows');
  const [writeBehavior, setWriteBehavior] = useState('merge');
  const [creating, setCreating] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [savingTrigger, setSavingTrigger] = useState(false);
  const [busyById, setBusyById] = useState<Record<string, BusyAction>>({});
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const {
    data: providers = [],
    isLoading: providersLoading,
  } = useSWR(['workflow-providers'], getWorkflowProviderSpecs, {
    revalidateOnFocus: false,
  });
  const {
    data: connections = [],
    isLoading: connectionsLoading,
    mutate: mutateConnections,
  } = useSWR(['workflow-connections', projectId], () => listWorkflowConnections(projectId), {
    revalidateOnFocus: true,
  });
  const {
    data: workflowStatus,
    mutate: mutateStatus,
  } = useSWR(['workflow-status', projectId], () => getWorkflowStatus(projectId), {
    revalidateOnFocus: true,
  });
  const {
    data: failedRuns = [],
    mutate: mutateFailedRuns,
  } = useSWR(['workflow-failed-runs', projectId], () => listWorkflowFailedRuns(projectId, 8), {
    revalidateOnFocus: true,
  });

  const visibleProviders = useMemo(
    () => providers.filter((provider) => provider.category === 'datasource'),
    [providers],
  );
  const providersById = useMemo(
    () => new Map(visibleProviders.map((provider) => [provider.provider, provider])),
    [visibleProviders],
  );
  const statusById = useMemo(
    () => new Map((workflowStatus?.syncs ?? []).map((item) => [item.id, item])),
    [workflowStatus?.syncs],
  );
  const selectedProvider = useMemo(
    () => visibleProviders.find((provider) => provider.provider === selectedProviderId),
    [selectedProviderId, visibleProviders],
  );
  const selectedConnection = useMemo(
    () => connections.find((connection) => connection.id === selectedConnectionId),
    [connections, selectedConnectionId],
  );
  const selectedStatus = selectedConnection ? statusById.get(selectedConnection.id) : undefined;
  const selectedConnectionProvider = selectedConnection
    ? providersById.get(selectedConnection.provider)
    : undefined;

  useEffect(() => {
    if (!selectedProviderId && visibleProviders.length) {
      setSelectedProviderId(visibleProviders[0].provider);
    }
  }, [selectedProviderId, visibleProviders]);

  useEffect(() => {
    if (!selectedProvider) return;
    setConfigValues(defaultConfigForProvider(selectedProvider));
    setTargetPath(targetDefault(selectedProvider));
    setTriggerMode(selectedProvider.default_sync_mode === 'scheduled' ? 'scheduled' : 'manual');
  }, [selectedProvider]);

  useEffect(() => {
    if (mode === 'new') return;
    if (!connections.length) {
      setSelectedConnectionId(null);
      return;
    }
    const stillExists = selectedConnectionId
      ? connections.some((connection) => connection.id === selectedConnectionId)
      : false;
    if (!stillExists) {
      setSelectedConnectionId(connections[0].id);
    }
  }, [connections, mode, selectedConnectionId]);

  const missingRequired = useMemo(() => {
    if (!selectedProvider) return true;
    return (selectedProvider.config_fields ?? []).some((field) => (
      field.required && !(configValues[field.key] ?? '').trim()
    ));
  }, [configValues, selectedProvider]);

  const oauthKey = providerOAuthKey(selectedProvider);
  const canAuthorize = Boolean(oauthKey && OAUTH_MAP[oauthKey]);
  const usesOAuth = selectedProvider?.auth === 'oauth' || selectedProvider?.auth === 'optional_oauth';
  const detailProvider = mode === 'new' ? selectedProvider : selectedConnectionProvider;
  const detailTitle = mode === 'new'
    ? 'New workflow'
    : workflowName(selectedConnection, selectedConnectionProvider);
  const detailStatus = mode === 'new' ? 'draft' : selectedConnection?.status || 'active';
  const detailTrigger = mode === 'new'
    ? { mode: triggerMode, schedule, timezone }
    : triggerFromStatus(selectedStatus);
  const selectedBusy = selectedConnection ? busyById[selectedConnection.id] ?? null : null;
  const paused = selectedConnection?.status === 'paused';
  const hasSelection = mode === 'new' || Boolean(selectedConnection);

  const recentRuns = useMemo(
    () => buildRecentRuns(selectedConnectionId, selectedConnection?.status, selectedConnection?.path, selectedStatus?.last_synced_at, failedRuns),
    [failedRuns, selectedConnection?.path, selectedConnection?.status, selectedConnectionId, selectedStatus?.last_synced_at],
  );

  const refreshAll = async () => {
    await Promise.all([
      mutateConnections(),
      mutateStatus(),
      mutateFailedRuns(),
    ]);
  };

  const handleAuthorize = async () => {
    const saasType = oauthKey ? OAUTH_MAP[oauthKey] : undefined;
    if (!saasType) return;
    setAuthBusy(true);
    setFeedback(null);
    try {
      await openOAuthPopup(saasType);
      setFeedback({ type: 'success', text: 'Authorization window closed.' });
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'Authorization failed.',
      });
    } finally {
      setAuthBusy(false);
    }
  };

  const handleCreate = async () => {
    if (!selectedProvider || missingRequired || !targetPath.trim()) return;
    setCreating(true);
    setFeedback(null);
    try {
      const result = await createWorkflow({
        project_id: projectId,
        provider: selectedProvider.provider,
        config: {
          ...cleanConfig(configValues),
          sync_behavior: {
            match_strategy: matchStrategy,
            change_policy: changePolicy,
            delete_policy: deletePolicy,
          },
          target_output: targetOutput,
          write_behavior: writeBehavior,
        },
        target_path: targetPath.trim(),
        direction: selectedProvider.supported_directions?.[0] ?? 'inbound',
        sync_mode: triggerMode,
        trigger: triggerMode === 'scheduled'
          ? { type: 'scheduled', schedule: schedule.trim(), timezone: timezone.trim() }
          : { type: 'manual' },
      });
      setFeedback({ type: 'success', text: 'Workflow created.' });
      setMode('detail');
      setSelectedConnectionId(result.sync.id);
      await refreshAll();
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to create workflow.',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleConnectionAction = async (connectionId: string, action: Exclude<BusyAction, null>) => {
    if (action === 'delete' && !window.confirm('Delete this workflow?')) return;
    setBusyById((current) => ({ ...current, [connectionId]: action }));
    setFeedback(null);
    try {
      if (action === 'refresh') await refreshWorkflowConnection(connectionId);
      if (action === 'pause') await pauseWorkflowConnection(connectionId);
      if (action === 'resume') await resumeWorkflowConnection(connectionId);
      if (action === 'delete') {
        await deleteWorkflowConnection(connectionId);
        setSelectedConnectionId(null);
      }
      await refreshAll();
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : `Failed to ${action}.`,
      });
    } finally {
      setBusyById((current) => ({ ...current, [connectionId]: null }));
    }
  };

  const openTriggerEditor = () => {
    if (mode === 'detail') {
      const trigger = triggerFromStatus(selectedStatus);
      setTriggerMode(trigger.mode);
      setSchedule(trigger.schedule);
      setTimezone(trigger.timezone);
    }
    setTriggerOpen((current) => !current);
  };

  const saveTrigger = async () => {
    if (mode === 'new') {
      setTriggerOpen(false);
      return;
    }
    if (!selectedConnection) return;
    setSavingTrigger(true);
    setFeedback(null);
    try {
      await updateWorkflowTrigger(selectedConnection.id, {
        sync_mode: triggerMode,
        trigger: triggerMode === 'scheduled'
          ? { type: 'scheduled', schedule: schedule.trim(), timezone: timezone.trim() }
          : { type: 'manual' },
      });
      setTriggerOpen(false);
      await refreshAll();
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to update trigger.',
      });
    } finally {
      setSavingTrigger(false);
    }
  };

  if (providersLoading && connectionsLoading) {
    return <ProjectPageLoadingShell />;
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.pageTitleGroup}>
          <span className={styles.pageTitle}>Workflows</span>
          <span className={styles.countBadge}>{connections.length}</span>
        </div>
        <button
          type="button"
          className={styles.newButton}
          onClick={() => {
            setMode('new');
            setTriggerOpen(false);
            setFeedback(null);
          }}
        >
          <Plus size={14} />
          <span>New workflow</span>
        </button>
      </header>
      <div className={styles.pageBody}>
        <WorkflowSidebar
          connections={connections}
          connectionsLoading={connectionsLoading}
          providersById={providersById}
          statusById={statusById}
          mode={mode}
          selectedConnectionId={selectedConnectionId}
          onSelect={(id) => {
            setMode('detail');
            setSelectedConnectionId(id);
            setTriggerOpen(false);
            setFeedback(null);
          }}
        />
        <WorkflowDetail
          projectId={projectId}
          mode={mode}
          hasSelection={hasSelection}
          selectedConnection={selectedConnection}
          selectedStatus={selectedStatus}
          detailProvider={detailProvider}
          detailTitle={detailTitle}
          detailStatus={detailStatus}
          detailTrigger={detailTrigger}
          selectedBusy={selectedBusy}
          paused={paused}
          feedback={feedback}
          visibleProviders={visibleProviders}
          selectedProvider={selectedProvider}
          selectedProviderId={selectedProviderId}
          setSelectedProviderId={setSelectedProviderId}
          configValues={configValues}
          setConfigValues={setConfigValues}
          targetPath={targetPath}
          setTargetPath={setTargetPath}
          triggerMode={triggerMode}
          setTriggerMode={setTriggerMode}
          schedule={schedule}
          setSchedule={setSchedule}
          timezone={timezone}
          setTimezone={setTimezone}
          matchStrategy={matchStrategy}
          setMatchStrategy={setMatchStrategy}
          changePolicy={changePolicy}
          setChangePolicy={setChangePolicy}
          deletePolicy={deletePolicy}
          setDeletePolicy={setDeletePolicy}
          targetOutput={targetOutput}
          setTargetOutput={setTargetOutput}
          writeBehavior={writeBehavior}
          setWriteBehavior={setWriteBehavior}
          triggerOpen={triggerOpen}
          savingTrigger={savingTrigger}
          creating={creating}
          authBusy={authBusy}
          missingRequired={missingRequired}
          usesOAuth={usesOAuth}
          canAuthorize={canAuthorize}
          recentRuns={recentRuns}
          onAuthorize={handleAuthorize}
          onCreate={handleCreate}
          onConnectionAction={handleConnectionAction}
          onOpenTriggerEditor={openTriggerEditor}
          onCloseTrigger={() => setTriggerOpen(false)}
          onSaveTrigger={saveTrigger}
          onRefreshAll={refreshAll}
        />
      </div>
    </div>
  );
}

function buildRecentRuns(
  selectedConnectionId: string | null,
  status: string | undefined,
  path: string | null | undefined,
  lastSyncedAt: string | null | undefined,
  failedRuns: WorkflowFailedRunRow[],
): RecentRun[] {
  if (!selectedConnectionId) return [];
  const target = path || 'Project root';
  const rows: RecentRun[] = [];
  if (status === 'syncing') {
    rows.push({
      id: `${selectedConnectionId}-running`,
      time: 'Now',
      result: 'Running',
      items: '-',
      target,
      duration: '-',
    });
  }
  if (lastSyncedAt) {
    rows.push({
      id: `${selectedConnectionId}-success`,
      time: formatDate(lastSyncedAt),
      result: 'Success',
      items: 'Updated',
      target,
      duration: '-',
    });
  }
  for (const run of failedRuns.filter((item) => item.connection_id === selectedConnectionId)) {
    rows.push({
      id: run.id,
      time: formatDate(run.finished_at || run.started_at),
      result: 'Failed',
      items: run.result_summary || run.error || 'Failed run',
      target: run.target_path || target,
      duration: run.duration_ms ? `${Math.round(run.duration_ms / 1000)}s` : '-',
    });
  }
  return rows.slice(0, 5);
}
