import { create } from 'zustand';

export type OnboardingStep = 
  | 'scope' 
  | 'ingestion' 
  | 'verification' 
  | 'configuration' 
  | 'testing';

export type ScenarioType = 'coding' | 'product' | 'knowledge' | 'custom';

export interface OnboardingState {
  // Step Control
  currentStep: OnboardingStep;
  setStep: (step: OnboardingStep) => void;
  
  // Step 1: Scope
  projectName: string;
  setProjectName: (name: string) => void;
  scenario: ScenarioType | null;
  setScenario: (scenario: ScenarioType) => void;

  // Step 2: Ingestion
  dataSourceType: 'file' | 'url' | 'connector' | 'demo' | null;
  setDataSourceType: (type: 'file' | 'url' | 'connector' | 'demo' | null) => void;
  demoDataId: string | null;
  setDemoDataId: (id: string | null) => void;
  
  // Result
  projectId: string | null;
  setProjectId: (id: string) => void;
  tableId: string | null;
  setTableId: (id: string) => void;

  // Reset
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  currentStep: 'scope',
  setStep: (step) => set({ currentStep: step }),

  projectName: '',
  setProjectName: (name) => set({ projectName: name }),
  
  scenario: null,
  setScenario: (scenario) => set({ scenario }),

  dataSourceType: null,
  setDataSourceType: (type) => set({ dataSourceType: type }),
  
  demoDataId: null,
  setDemoDataId: (id) => set({ demoDataId: id }),

  projectId: null,
  setProjectId: (id) => set({ projectId: id }),
  
  tableId: null,
  setTableId: (id) => set({ tableId: id }),

  reset: () => set({
    currentStep: 'scope',
    projectName: '',
    scenario: null,
    dataSourceType: null,
    demoDataId: null,
    projectId: null,
    tableId: null,
  }),
}));

