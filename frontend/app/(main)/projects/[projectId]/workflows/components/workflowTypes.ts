import type { Dispatch, SetStateAction } from 'react';
import type {
  WorkflowConnection,
  WorkflowProviderSpec,
  WorkflowStatusItem,
} from '@/lib/workflowApi';
import type {
  BusyAction,
  DetailMode,
  RecentRun,
  TriggerDraft,
  TriggerMode,
} from './workflowHelpers';

export type WorkflowFeedback = { type: 'error' | 'success'; text: string } | null;

export type WorkflowDetailProps = {
  projectId: string;
  mode: DetailMode;
  hasSelection: boolean;
  selectedConnection?: WorkflowConnection;
  selectedStatus?: WorkflowStatusItem;
  detailProvider?: WorkflowProviderSpec;
  detailTitle: string;
  detailStatus: string;
  detailTrigger: TriggerDraft;
  selectedBusy: BusyAction;
  paused: boolean;
  feedback: WorkflowFeedback;
  visibleProviders: WorkflowProviderSpec[];
  selectedProvider?: WorkflowProviderSpec;
  selectedProviderId: string;
  setSelectedProviderId: Dispatch<SetStateAction<string>>;
  configValues: Record<string, string>;
  setConfigValues: Dispatch<SetStateAction<Record<string, string>>>;
  targetPath: string;
  setTargetPath: Dispatch<SetStateAction<string>>;
  triggerMode: TriggerMode;
  setTriggerMode: Dispatch<SetStateAction<TriggerMode>>;
  schedule: string;
  setSchedule: Dispatch<SetStateAction<string>>;
  timezone: string;
  setTimezone: Dispatch<SetStateAction<string>>;
  matchStrategy: string;
  setMatchStrategy: Dispatch<SetStateAction<string>>;
  changePolicy: string;
  setChangePolicy: Dispatch<SetStateAction<string>>;
  deletePolicy: string;
  setDeletePolicy: Dispatch<SetStateAction<string>>;
  targetOutput: string;
  setTargetOutput: Dispatch<SetStateAction<string>>;
  writeBehavior: string;
  setWriteBehavior: Dispatch<SetStateAction<string>>;
  triggerOpen: boolean;
  savingTrigger: boolean;
  creating: boolean;
  authBusy: boolean;
  missingRequired: boolean;
  usesOAuth: boolean;
  canAuthorize: boolean;
  recentRuns: RecentRun[];
  onAuthorize: () => Promise<void>;
  onCreate: () => Promise<void>;
  onConnectionAction: (id: string, action: Exclude<BusyAction, null>) => Promise<void>;
  onOpenTriggerEditor: () => void;
  onCloseTrigger: () => void;
  onSaveTrigger: () => Promise<void>;
  onRefreshAll: () => Promise<void>;
};
