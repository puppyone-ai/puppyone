'use client';

import {
  ArrowRight,
  ExternalLink,
  Folder,
  Loader2,
  Plus,
} from 'lucide-react';
import { ActionButton } from '@/components/ui/ActionButton';
import { Field, SelectField } from '@/components/ui/Field';
import { ConfigFieldInput, ProviderMark } from './WorkflowPrimitives';
import { DestinationSettingsForm, ProjectFolderSelect, SourceSettingsForm } from './WorkflowNodeForms';
import styles from './WorkflowPage.module.css';
import {
  providerName,
  triggerLabel,
} from './workflowHelpers';
import { WorkflowTriggerControl } from './WorkflowTriggerControl';
import type { WorkflowShellProps } from './workflowTypes';
import type { ReactNode } from 'react';

export function WorkflowFlow(props: WorkflowShellProps) {
  if (props.model.mode === 'new') {
    return <NewWorkflowBuilder {...props} />;
  }

  const sourceTitle = providerName(
    props.model.detailProvider,
    props.model.selectedConnection?.provider || 'Source',
  );
  const targetTitle = props.model.selectedConnection?.path || 'Project root';
  const triggerText = triggerLabel(props.model.detailTrigger.mode, props.model.detailTrigger.schedule);

  return (
    <section className={styles.workflowPanel}>
      <PanelHeader
        title="Workflow"
        subtitle={`${sourceTitle} to ${targetTitle}`}
        triggerText={triggerText}
        {...props}
      />
      <div className={styles.connectionGrid}>
        <FlowNodeCard
          tone="source"
          icon={<ProviderMark provider={props.model.detailProvider} />}
          label="Source"
          title={sourceTitle}
        >
          <SourceSettingsForm {...props} />
        </FlowNodeCard>
        <FlowConnector />
        <FlowNodeCard
          tone="target"
          icon={<Folder size={18} />}
          label="Destination"
          title={targetTitle}
        >
          <DestinationSettingsForm targetPath={props.model.selectedConnection?.path ?? ''} {...props} />
        </FlowNodeCard>
      </div>
    </section>
  );
}

function NewWorkflowBuilder(props: WorkflowShellProps) {
  const { model, actions } = props;
  const triggerText = triggerLabel(model.detailTrigger.mode, model.detailTrigger.schedule);
  const createDisabled = model.creating || model.missingRequired || !model.targetPath.trim() || Boolean(model.triggerError);
  const createHint = model.visibleProviders.length === 0
    ? 'No providers available'
    : !model.selectedProvider
      ? 'Choose a provider'
      : model.missingRequired
        ? 'Fill required fields'
        : !model.targetPath.trim()
          ? 'Add a project path'
          : model.triggerError || 'Ready to create';

  return (
    <section className={styles.workflowPanel}>
      <PanelHeader
        title="Create sync"
        subtitle="Choose a source, destination path, and run mode."
        triggerText={triggerText}
        {...props}
      />
      <div className={styles.connectionGrid}>
        <FlowNodeCard
          tone="source"
          icon={<ProviderMark provider={model.selectedProvider} />}
          label="Source"
          title={model.selectedProvider?.display_name || 'Provider'}
        >
          <div className={styles.nodeSettings}>
            <div className={styles.settingsGrid}>
              <Field label="Provider">
                <SelectField
                  value={model.selectedProviderId}
                  onChange={(event) => actions.setSelectedProviderId(event.target.value)}
                >
                  {model.visibleProviders.length === 0 ? (
                    <option value="">Provider</option>
                  ) : null}
                  {model.visibleProviders.map((provider) => (
                    <option key={provider.provider} value={provider.provider}>{provider.display_name}</option>
                  ))}
                </SelectField>
              </Field>
              {model.configFields.map((field) => (
                <Field
                  key={field.key}
                  label={`${field.label}${field.required ? ' *' : ''}`}
                  hint={field.hint}
                  error={model.configErrors[field.key]}
                >
                  <ConfigFieldInput
                    field={field}
                    value={model.configValues[field.key] ?? ''}
                    invalid={Boolean(model.configErrors[field.key])}
                    onChange={(value) => actions.setConfigValues((current) => ({ ...current, [field.key]: value }))}
                  />
                </Field>
              ))}
            </div>
          </div>
        </FlowNodeCard>

        <FlowConnector />

        <FlowNodeCard
          tone="target"
          icon={<Folder size={18} />}
          label="Destination"
          title={model.targetPath || 'Project folder'}
        >
          <div className={styles.nodeSettings}>
            <div className={styles.settingsGrid}>
              <Field label="Project folder" error={!model.targetPath.trim() ? 'Choose a folder' : undefined}>
                <ProjectFolderSelect
                  projectId={model.projectId}
                  value={model.targetPath}
                  invalid={!model.targetPath.trim()}
                  onChange={actions.setTargetPath}
                  missingLabel="new folder"
                />
              </Field>
            </div>
          </div>
        </FlowNodeCard>
      </div>

      <div className={styles.workflowPanelFooter}>
        <span className={createDisabled ? styles.createHintMuted : styles.createHintReady}>
          {createHint}
        </span>
        <div className={styles.newWorkflowActions}>
          {model.usesOAuth && model.canAuthorize ? (
            <ActionButton
              variant="secondary"
              size="sm"
              leadingIcon={model.authBusy ? <Loader2 size={15} className={styles.spin} /> : <ExternalLink size={15} />}
              onClick={() => void actions.authorize()}
              loading={model.authBusy}
            >
              Authorize
            </ActionButton>
          ) : null}
          <ActionButton
            variant="primary"
            size="sm"
            leadingIcon={model.creating ? <Loader2 size={15} className={styles.spin} /> : <Plus size={15} />}
            onClick={() => void actions.create()}
            loading={model.creating}
            disabled={createDisabled}
          >
            Create sync
          </ActionButton>
        </div>
      </div>
    </section>
  );
}

function PanelHeader({
  title,
  subtitle,
  triggerText,
  ...props
}: WorkflowShellProps & {
  title: string;
  subtitle: string;
  triggerText: string;
}) {
  return (
    <div className={styles.workflowPanelHeader}>
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      <WorkflowTriggerControl triggerText={triggerText} {...props} />
    </div>
  );
}

function FlowNodeCard({
  tone,
  icon,
  label,
  title,
  children,
}: {
  tone: 'source' | 'target';
  icon: ReactNode;
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={`${styles.flowNodeCard} ${tone === 'source' ? styles.sourceFlowNode : styles.targetFlowNode}`}>
      <div className={styles.nodeMain}>
        <div className={styles.nodeIcon}>{icon}</div>
        <div className={styles.nodeTitleBlock}>
          <div className={styles.nodeLabel}>{label}</div>
          <div className={styles.nodeTitle}>{title}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function FlowConnector() {
  return (
    <div className={styles.flowConnector} aria-hidden="true">
      <span className={styles.connectorLine} />
      <ArrowRight size={15} />
      <span className={styles.connectorLine} />
    </div>
  );
}
