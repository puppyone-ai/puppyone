'use client';

import { use } from 'react';
import { ProjectPageLoadingShell } from '@/components/loading';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useWorkflowController } from './hooks/useWorkflowController';
import styles from './components/WorkflowPage.module.css';
import { WorkflowCatalog } from './components/WorkflowCatalog';

type IntegrationsPageProps = {
  params: Promise<{ projectId: string }>;
};

export default function ProjectIntegrationsPage({ params }: IntegrationsPageProps) {
  const { projectId } = use(params);
  const { model, actions } = useWorkflowController(projectId);

  if (model.loading) {
    return <ProjectPageLoadingShell />;
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.pageTitleGroup}>
          <span className={styles.pageTitle}>Integrations</span>
          <span className={styles.countBadge}>{model.connections.length}</span>
        </div>
      </header>
      <main className={styles.workflowCanvas}>
        <WorkflowCatalog model={model} actions={actions} />
      </main>
      <ConfirmDialog
        open={Boolean(model.deleteTarget)}
        title="Delete integration"
        description="This removes the integration configuration. Existing project files stay in place."
        confirmLabel="Delete"
        loading={model.deleteLoading}
        onCancel={actions.cancelDelete}
        onConfirm={() => void actions.confirmDelete()}
      />
    </div>
  );
}
