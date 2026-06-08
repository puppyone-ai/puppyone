'use client';

import {
  CalendarClock,
  Check,
  Clock3,
  ExternalLink,
  Folder,
  Loader2,
  Plus,
} from 'lucide-react';
import { ConfigFieldInput, ProviderMark } from './WorkflowPrimitives';
import styles from './WorkflowPage.module.css';
import {
  providerName,
  triggerLabel,
} from './workflowHelpers';
import type { WorkflowDetailProps } from './workflowTypes';

export function WorkflowFlow(props: WorkflowDetailProps) {
  if (props.mode === 'new') {
    return <NewWorkflowBuilder {...props} />;
  }

  const sourceTitle = providerName(
    props.detailProvider,
    props.selectedConnection?.provider || 'Source',
  );
  const targetTitle = props.selectedConnection?.path || 'Project root';
  const triggerText = triggerLabel(props.detailTrigger.mode, props.detailTrigger.schedule);

  return (
    <section className={styles.flowSurface}>
      <div className={styles.workflowCanvas}>
        <div className={styles.workflowMap}>
          <SourceFlowNode sourceTitle={sourceTitle} triggerText={triggerText} {...props} />
          <div className={styles.flowConnector} aria-hidden="true">
            <span className={styles.connectorLine} />
          </div>
          <TargetFlowNode targetTitle={targetTitle} {...props} />
        </div>

      </div>
    </section>
  );
}

function NewWorkflowBuilder(props: WorkflowDetailProps) {
  const triggerText = triggerLabel(props.detailTrigger.mode, props.detailTrigger.schedule);
  const hasConfig = (props.selectedProvider?.config_fields ?? []).length > 0;
  const createDisabled = props.creating || props.missingRequired || !props.targetPath.trim();
  const createHint = props.visibleProviders.length === 0
    ? 'No providers available'
    : !props.selectedProvider
      ? 'Choose a provider'
      : props.missingRequired
        ? 'Fill required fields'
        : !props.targetPath.trim()
          ? 'Add a project path'
          : 'Ready to create';

  return (
    <section className={styles.flowSurface}>
      <div className={`${styles.workflowCanvas} ${styles.newWorkflowCanvas}`}>
        <div className={styles.newWorkflowMap}>
          <div className={`${styles.newWorkflowNode} ${styles.sourceFlowNode}`}>
            <div className={styles.nodeIcon}>
              <ProviderMark provider={props.selectedProvider} />
            </div>
            <label className={styles.nodeField}>
              <span>Provider</span>
              <select
                className={styles.nodeSelect}
                value={props.selectedProviderId}
                onChange={(event) => props.setSelectedProviderId(event.target.value)}
              >
                {props.visibleProviders.length === 0 ? (
                  <option value="">Provider</option>
                ) : null}
                {props.visibleProviders.map((provider) => (
                  <option key={provider.provider} value={provider.provider}>{provider.display_name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={props.triggerOpen ? `${styles.triggerChip} ${styles.triggerChipActive}` : styles.triggerChip}
              onClick={props.onOpenTriggerEditor}
            >
              {props.detailTrigger.mode === 'scheduled' ? <CalendarClock size={14} /> : <Clock3 size={14} />}
              <span>{triggerText}</span>
            </button>
            {props.triggerOpen ? <TriggerEditorOverlay {...props} /> : null}
          </div>

          <div className={styles.flowConnector} aria-hidden="true">
            <span className={styles.connectorLine} />
          </div>

          <div className={`${styles.newWorkflowNode} ${styles.targetFlowNode}`}>
            <div className={styles.nodeIcon}>
              <Folder size={18} />
            </div>
            <label className={styles.nodeField}>
              <span>Project path</span>
              <input
                className={styles.nodeInput}
                value={props.targetPath}
                onChange={(event) => props.setTargetPath(event.target.value)}
                placeholder="Gmail"
              />
            </label>
          </div>
        </div>

        {hasConfig ? <ProviderConfigFields {...props} /> : null}

        <div className={styles.newWorkflowFooter}>
          <span className={createDisabled ? styles.createHintMuted : styles.createHintReady}>{createHint}</span>
          <div className={styles.newWorkflowActions}>
            {props.usesOAuth && props.canAuthorize ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void props.onAuthorize()}
                disabled={props.authBusy}
              >
                {props.authBusy ? <Loader2 size={15} className={styles.spin} /> : <ExternalLink size={15} />}
                <span>Authorize</span>
              </button>
            ) : null}
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void props.onCreate()}
              disabled={createDisabled}
            >
              {props.creating ? <Loader2 size={15} className={styles.spin} /> : <Plus size={15} />}
              <span>Create workflow</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SourceFlowNode(props: WorkflowDetailProps & { sourceTitle: string; triggerText: string }) {
  const {
    detailProvider,
    detailTrigger,
    triggerOpen,
    onOpenTriggerEditor,
    sourceTitle,
    triggerText,
  } = props;

  return (
    <div className={`${styles.flowNodeTile} ${styles.sourceFlowNode}`}>
      <div className={styles.nodeMain}>
        <div className={styles.nodeIcon}>
          <ProviderMark provider={detailProvider} />
        </div>
        <div className={styles.nodeTitleBlock}>
          <div className={styles.nodeTitle}>{sourceTitle}</div>
        </div>
        <button
          type="button"
          className={triggerOpen ? `${styles.triggerChip} ${styles.triggerChipActive}` : styles.triggerChip}
          onClick={onOpenTriggerEditor}
        >
          {detailTrigger.mode === 'scheduled' ? <CalendarClock size={14} /> : <Clock3 size={14} />}
          <span>{triggerText}</span>
        </button>
      </div>

      {triggerOpen ? <TriggerEditorOverlay {...props} /> : null}
    </div>
  );
}

function TargetFlowNode({
  targetTitle,
}: WorkflowDetailProps & { targetTitle: string }) {
  return (
    <div className={`${styles.flowNodeTile} ${styles.targetFlowNode}`}>
      <div className={styles.nodeMain}>
        <div className={styles.nodeIcon}>
          <Folder size={18} />
        </div>
        <div className={styles.nodeTitleBlock}>
          <div className={styles.nodeTitle}>{targetTitle}</div>
        </div>
      </div>
    </div>
  );
}

function ProviderConfigFields({
  selectedProvider,
  configValues,
  setConfigValues,
}: WorkflowDetailProps) {
  return (
    <div className={styles.newConfigGrid}>
      {(selectedProvider?.config_fields ?? []).map((field) => (
        <label className={styles.field} key={field.key}>
          <span>{field.label}{field.required ? ' *' : ''}</span>
          <ConfigFieldInput
            field={field}
            value={configValues[field.key] ?? ''}
            onChange={(value) => setConfigValues((current) => ({ ...current, [field.key]: value }))}
          />
        </label>
      ))}
    </div>
  );
}

function TriggerEditorOverlay({
  triggerMode,
  setTriggerMode,
  schedule,
  setSchedule,
  timezone,
  setTimezone,
  savingTrigger,
  onCloseTrigger,
  onSaveTrigger,
}: WorkflowDetailProps) {
  return (
    <div className={styles.triggerEditorOverlay}>
      <div className={styles.popoverTitle}>Trigger</div>
      <div className={styles.segmented}>
        <button
          type="button"
          className={triggerMode === 'manual' ? styles.selected : ''}
          onClick={() => setTriggerMode('manual')}
        >
          Manual
        </button>
        <button
          type="button"
          className={triggerMode === 'scheduled' ? styles.selected : ''}
          onClick={() => setTriggerMode('scheduled')}
        >
          Scheduled
        </button>
      </div>
      {triggerMode === 'scheduled' ? (
        <div className={styles.popoverGrid}>
          <label className={styles.field}>
            <span>Cron</span>
            <input className={styles.input} value={schedule} onChange={(event) => setSchedule(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Timezone</span>
            <input className={styles.input} value={timezone} onChange={(event) => setTimezone(event.target.value)} />
          </label>
        </div>
      ) : null}
      <div className={styles.popoverActions}>
        <button type="button" className={`${styles.secondaryButton} ${styles.compactButton}`} onClick={onCloseTrigger}>
          Close
        </button>
        <button type="button" className={`${styles.primaryButton} ${styles.compactButton}`} onClick={() => void onSaveTrigger()} disabled={savingTrigger}>
          {savingTrigger ? <Loader2 size={14} className={styles.spin} /> : <Check size={14} />}
          <span>Save</span>
        </button>
      </div>
    </div>
  );
}
