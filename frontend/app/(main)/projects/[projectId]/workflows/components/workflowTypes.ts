import type { WorkflowActions, WorkflowViewModel } from '../hooks/useWorkflowController';

export type WorkflowShellProps = {
  model: WorkflowViewModel;
  actions: WorkflowActions;
};
