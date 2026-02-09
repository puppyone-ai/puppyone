import { create } from 'zustand';

export type OnboardingStep =
  | 'scope'
  | 'ingestion'
  | 'verification'
  | 'configuration'
  | 'testing';

export type ScenarioType = 'coding' | 'product' | 'knowledge' | 'custom';

// ETL Task tracking
export type ETLTaskState =
  | 'uploading'
  | 'pending'
  | 'parsing'
  | 'completed'
  | 'failed';

export interface TrackedFile {
  file: File;
  state: ETLTaskState;
  taskId?: string;
  progress?: number;
  error?: string;
  result?: any;
}

export interface OnboardingState {
  // Step Control
  currentStep: OnboardingStep;
  setStep: (step: OnboardingStep) => void;

  // Step 1: Scope
  projectName: string;
  setProjectName: (name: string) => void;
  scenario: ScenarioType | null;
  setScenario: (scenario: ScenarioType) => void;

  // Step 2: Ingestion - Selected Sources
  selectedSources: string[];
  setSelectedSources: (sources: string[]) => void;

  // Legacy (keeping for compatibility)
  dataSourceType: 'file' | 'url' | 'connector' | 'demo' | null;
  setDataSourceType: (
    type: 'file' | 'url' | 'connector' | 'demo' | null
  ) => void;
  demoDataId: string | null;
  setDemoDataId: (id: string | null) => void;

  // Step 2: Uploaded Files with tracking
  uploadedFiles: File[];
  setUploadedFiles: (files: File[]) => void;
  trackedFiles: TrackedFile[];
  setTrackedFiles: (files: TrackedFile[]) => void;
  updateTrackedFile: (index: number, update: Partial<TrackedFile>) => void;

  // Step 2: Apps & URLs
  connectedApps: string[];
  setConnectedApps: (apps: string[]) => void;
  enteredUrls: string[];
  setEnteredUrls: (urls: string[]) => void;

  // Result
  projectId: string | null;
  setProjectId: (id: string) => void;
  tableId: string | null;
  setTableId: (id: string) => void;

  // Reset
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>(set => ({
  currentStep: 'scope',
  setStep: step => set({ currentStep: step }),

  projectName: '',
  setProjectName: name => set({ projectName: name }),

  scenario: null,
  setScenario: scenario => set({ scenario }),

  // Step 2: Selected Sources
  selectedSources: [],
  setSelectedSources: sources => set({ selectedSources: sources }),

  // Legacy
  dataSourceType: null,
  setDataSourceType: type => set({ dataSourceType: type }),

  demoDataId: null,
  setDemoDataId: id => set({ demoDataId: id }),

  // Step 2: Uploads with tracking
  uploadedFiles: [],
  setUploadedFiles: files => set({ uploadedFiles: files }),
  trackedFiles: [],
  setTrackedFiles: files => set({ trackedFiles: files }),
  updateTrackedFile: (index, update) =>
    set(state => {
      const newTrackedFiles = [...state.trackedFiles];
      if (newTrackedFiles[index]) {
        newTrackedFiles[index] = { ...newTrackedFiles[index], ...update };
      }
      return { trackedFiles: newTrackedFiles };
    }),

  // Apps & URLs
  connectedApps: [],
  setConnectedApps: apps => set({ connectedApps: apps }),
  enteredUrls: [],
  setEnteredUrls: urls => set({ enteredUrls: urls }),

  projectId: null,
  setProjectId: id => set({ projectId: id }),

  tableId: null,
  setTableId: id => set({ tableId: id }),

  reset: () =>
    set({
      currentStep: 'scope',
      projectName: '',
      scenario: null,
      selectedSources: [],
      dataSourceType: null,
      demoDataId: null,
      uploadedFiles: [],
      trackedFiles: [],
      connectedApps: [],
      enteredUrls: [],
      projectId: null,
      tableId: null,
    }),
}));
