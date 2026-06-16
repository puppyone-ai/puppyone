'use client';

import { CalendarClock, Check, Clock3 } from 'lucide-react';
import { ActionButton } from '@/components/ui/ActionButton';
import { Field, TextField } from '@/components/ui/Field';
import styles from './WorkflowPage.module.css';
import type { WorkflowShellProps } from './workflowTypes';

export function WorkflowTriggerControl({
  model,
  actions,
  triggerText,
}: WorkflowShellProps & { triggerText: string }) {
  return (
    <div className={styles.triggerAnchor}>
      <button
        type="button"
        className={model.triggerOpen ? `${styles.triggerButton} ${styles.triggerButtonActive}` : styles.triggerButton}
        onClick={actions.openTriggerEditor}
        aria-expanded={model.triggerOpen}
        aria-label={`Trigger: ${triggerText}`}
      >
        {model.detailTrigger.mode === 'scheduled' ? <CalendarClock size={14} /> : <Clock3 size={14} />}
        <span>{triggerText}</span>
      </button>
      {model.triggerOpen ? (
        <TriggerEditorOverlay model={model} actions={actions} />
      ) : null}
    </div>
  );
}

function TriggerEditorOverlay({ model, actions }: WorkflowShellProps) {
  return (
    <div className={styles.triggerEditorOverlay}>
      <div className={styles.popoverTitle}>Run mode</div>
      <div className={styles.segmented}>
        <button
          type="button"
          className={model.triggerMode === 'manual' ? styles.selected : ''}
          onClick={() => actions.setTriggerMode('manual')}
        >
          Manual
        </button>
        <button
          type="button"
          className={model.triggerMode === 'scheduled' ? styles.selected : ''}
          onClick={() => actions.setTriggerMode('scheduled')}
        >
          Scheduled
        </button>
      </div>
      {model.triggerMode === 'scheduled' ? (
        <div className={styles.popoverGrid}>
          <Field label="Cron" error={model.triggerError?.includes('Schedule') ? model.triggerError : undefined}>
            <TextField
              value={model.schedule}
              invalid={model.triggerError?.includes('Schedule')}
              onChange={(event) => actions.setSchedule(event.target.value)}
            />
          </Field>
          <Field label="Timezone" error={model.triggerError?.includes('Timezone') ? model.triggerError : undefined}>
            <TextField
              value={model.timezone}
              invalid={model.triggerError?.includes('Timezone')}
              onChange={(event) => actions.setTimezone(event.target.value)}
            />
          </Field>
        </div>
      ) : null}
      <div className={styles.popoverActions}>
        <ActionButton size="sm" variant="secondary" onClick={actions.closeTrigger}>
          Close
        </ActionButton>
        <ActionButton
          size="sm"
          variant="primary"
          disabled={Boolean(model.triggerError)}
          loading={model.savingTrigger}
          leadingIcon={<Check size={14} />}
          onClick={() => void actions.saveTrigger()}
        >
          Save
        </ActionButton>
      </div>
    </div>
  );
}
