import React from 'react';
import { useOnboardingStore } from './store';
import { Step1_Scope } from './steps/Step1_Scope';
import { Step2_Ingestion } from './steps/Step2_Ingestion';
import { Step3_Verification } from './steps/Step3_Verification';
import { Step4_Configuration } from './steps/Step4_Configuration';
import { Step5_Testing } from './steps/Step5_Testing';

interface OnboardingWizardProps {
  onComplete?: () => void;
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const currentStep = useOnboardingStore(s => s.currentStep);

  switch (currentStep) {
    case 'scope':
      return <Step1_Scope />;
    case 'ingestion':
      return <Step2_Ingestion />;
    case 'verification':
      return <Step3_Verification />;
    case 'configuration':
      return <Step4_Configuration />;
    case 'testing':
      return <Step5_Testing onComplete={onComplete} />;
    default:
      return null;
  }
}
