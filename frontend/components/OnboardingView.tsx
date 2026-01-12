'use client';

import { useState } from 'react';
import { WelcomeScreen } from './onboarding/WelcomeScreen';
import { OnboardingWizard } from './onboarding/OnboardingWizard';
import { useOnboardingStore } from './onboarding/store';

interface OnboardingViewProps {
  onStart: () => void;
  isLoading?: boolean;
  userName?: string;
}

export function OnboardingView({
  onStart,
  isLoading = false,
  userName,
}: OnboardingViewProps) {
  const [showWizard, setShowWizard] = useState(false);
  const resetStore = useOnboardingStore(s => s.reset);

  // 当点击 Explore 时，进入 Wizard
  const handleExplore = () => {
    resetStore();
    setShowWizard(true);
  };

  // 如果 Wizard 还没开始，显示欢迎页
  if (!showWizard) {
    return (
      <WelcomeScreen
        onStart={handleExplore}
        isLoading={false}
        userName={userName}
      />
    );
  }

  // Wizard 模式
  // 这里的 onStart 是真正的进入主界面，会在 Wizard 的最后一步调用
  return <OnboardingWizard onComplete={onStart} />;
}
