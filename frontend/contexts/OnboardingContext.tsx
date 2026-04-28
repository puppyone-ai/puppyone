'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';

export type OnboardingStep =
  | 'project'
  | 'file'
  | 'access_point'
  | 'local_sync'
  | 'agent'
  | 'chat'
  | 'invite';

interface OnboardingState {
  hasSeenWelcome: boolean;
  completedSteps: OnboardingStep[];
  dismissedChecklist: boolean;
  collapsedChecklist: boolean;
}

interface OnboardingContextValue extends OnboardingState {
  progress: number;
  total: number;
  completeWelcome: () => void;
  resetWelcome: () => void;
  completeStep: (step: OnboardingStep) => void;
  dismissChecklist: () => void;
  openChecklist: () => void;
  collapseChecklist: () => void;
  isCompleted: (step: OnboardingStep) => boolean;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

const STORAGE_KEY = 'puppyone_onboarding_v1';
const DEFAULT: OnboardingState = {
  hasSeenWelcome: false,
  completedSteps: [],
  dismissedChecklist: false,
  collapsedChecklist: false,
};

function load(): OnboardingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT, ...JSON.parse(raw) } : DEFAULT;
  } catch { return DEFAULT; }
}

function save(state: OnboardingState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function OnboardingProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  // Always start from DEFAULT to match SSR — load real state after hydration in useEffect
  const [state, setState] = useState<OnboardingState>(DEFAULT);

  useEffect(() => {
    setState(load());
  }, []);

  const update = useCallback((patch: Partial<OnboardingState>) => {
    setState(prev => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);

  const completeWelcome = useCallback(() => update({ hasSeenWelcome: true }), [update]);
  const resetWelcome = useCallback(() => update({ hasSeenWelcome: false }), [update]);

  const completeStep = useCallback((step: OnboardingStep) => {
    setState(prev => {
      if (prev.completedSteps.includes(step)) return prev;
      const next = { ...prev, completedSteps: [...prev.completedSteps, step] };
      save(next);
      return next;
    });
  }, []);

  const dismissChecklist = useCallback(() => update({ dismissedChecklist: true }), [update]);
  const openChecklist = useCallback(() => update({ dismissedChecklist: false, collapsedChecklist: false }), [update]);
  const collapseChecklist = useCallback(() => update({ collapsedChecklist: true }), [update]);

  const isCompleted = useCallback(
    (step: OnboardingStep) => state.completedSteps.includes(step),
    [state.completedSteps]
  );

  const value = useMemo<OnboardingContextValue>(() => ({
    ...state,
    progress: state.completedSteps.length,
    total: 7,
    completeWelcome,
    resetWelcome,
    completeStep,
    dismissChecklist,
    openChecklist,
    collapseChecklist,
    isCompleted,
  }), [state, completeWelcome, resetWelcome, completeStep, dismissChecklist, openChecklist, collapseChecklist, isCompleted]);

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider');
  return ctx;
}
