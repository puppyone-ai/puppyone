'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';

interface OnboardingGuideProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  userName?: string;
}

type Step = 'welcome' | 'connect' | 'organize' | 'distribute' | 'done';

const STEPS: { id: Step; title: string; subtitle: string; icon: string; content: React.ReactNode }[] = [
  {
    id: 'welcome',
    title: 'Welcome to PuppyOne!',
    subtitle: 'Your context management platform for AI Agents',
    icon: '🎉',
    content: (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <p style={{ color: 'rgba(255,255,255,0.7)', lineHeight: 1.6, margin: 0 }}>
          We've prepared a <strong style={{ color: '#4599DF' }}>Get Started</strong> project 
          with example files to help you explore.
        </p>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 12 }}>
          Let's take a quick tour of what you can do here.
        </p>
      </div>
    ),
  },
  {
    id: 'connect',
    title: 'Connect Your Data',
    subtitle: 'Import from your favorite tools',
    icon: '🔗',
    content: (
      <div style={{ padding: '16px 0' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
          {[
            { name: 'Notion', icon: '/icons/notion.svg' },
            { name: 'GitHub', icon: '/icons/github.svg' },
            { name: 'Gmail', icon: '/icons/gmail.svg' },
            { name: 'Google Docs', icon: '/icons/google_doc.svg' },
          ].map((item) => (
            <div
              key={item.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 16px',
                background: 'rgba(255,255,255,0.05)',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              <img src={item.icon} alt={item.name} width={20} height={20} />
              <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>{item.name}</span>
            </div>
          ))}
        </div>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', marginTop: 16 }}>
          Click the <strong style={{ color: '#fff' }}>+</strong> button to import data from these sources.
        </p>
      </div>
    ),
  },
  {
    id: 'organize',
    title: 'Organize Your Context',
    subtitle: 'Structure your knowledge base',
    icon: '📁',
    content: (
      <div style={{ padding: '16px 0' }}>
        <div style={{ 
          background: 'rgba(0,0,0,0.3)', 
          borderRadius: 8, 
          padding: 16,
          fontFamily: 'monospace',
          fontSize: 13,
          color: 'rgba(255,255,255,0.7)',
          lineHeight: 1.8,
        }}>
          <div>📁 Knowledge_Base/</div>
          <div style={{ paddingLeft: 20 }}>📄 Product_Docs.md</div>
          <div style={{ paddingLeft: 20 }}>📄 API_Reference.json</div>
          <div>📁 Agent_Workspaces/</div>
          <div style={{ paddingLeft: 20 }}>🔒 Dev_Team_Only/</div>
          <div style={{ paddingLeft: 20 }}>👥 Marketing_Shared/</div>
        </div>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', marginTop: 16 }}>
          Create folders to organize content and set <strong style={{ color: '#fff' }}>permissions</strong> for different Agents.
        </p>
      </div>
    ),
  },
  {
    id: 'distribute',
    title: 'Distribute to Agents',
    subtitle: 'Turn context into actionable tools',
    icon: '🚀',
    content: (
      <div style={{ padding: '16px 0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { agent: 'Dev Agent', access: 'Technical docs, API specs', color: '#4ECDC4' },
            { agent: 'Support Agent', access: 'FAQs, Policies', color: '#FFE66D' },
            { agent: 'Marketing Agent', access: 'Brand guidelines', color: '#FF6B6B' },
          ].map((item) => (
            <div
              key={item.agent}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 8,
                borderLeft: `3px solid ${item.color}`,
              }}
            >
              <span style={{ color: '#fff', fontSize: 14, fontWeight: 500 }}>🤖 {item.agent}</span>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{item.access}</span>
            </div>
          ))}
        </div>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', marginTop: 16 }}>
          Each Agent only sees the context you assign to them.
        </p>
      </div>
    ),
  },
  {
    id: 'done',
    title: "You're All Set!",
    subtitle: 'Start exploring your workspace',
    icon: '✨',
    content: (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <p style={{ color: 'rgba(255,255,255,0.7)', lineHeight: 1.6, margin: 0 }}>
          Your <strong style={{ color: '#4599DF' }}>Get Started</strong> project has example files 
          for you to explore.
        </p>
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 12 }}>
          Feel free to edit, delete, or add anything. It's your playground!
        </p>
      </div>
    ),
  },
];

export function OnboardingGuide({ isOpen, onClose, onComplete, userName }: OnboardingGuideProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const currentStep = STEPS[currentStepIndex];
  const isLastStep = currentStepIndex === STEPS.length - 1;
  const isFirstStep = currentStepIndex === 0;

  const handleNext = () => {
    if (isLastStep) {
      onComplete();
      onClose();
    } else {
      setCurrentStepIndex((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (!isFirstStep) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  const handleSkip = () => {
    onComplete();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleSkip}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              backdropFilter: 'blur(8px)',
              zIndex: 9998,
            }}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.5, bounce: 0.3 }}
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '90%',
              maxWidth: 480,
              backgroundColor: '#141414',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 16,
              overflow: 'hidden',
              zIndex: 9999,
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            }}
          >
            {/* Progress Bar */}
            <div style={{ 
              height: 3, 
              background: 'rgba(255,255,255,0.1)',
              position: 'relative',
            }}>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${((currentStepIndex + 1) / STEPS.length) * 100}%` }}
                transition={{ duration: 0.3 }}
                style={{
                  height: '100%',
                  background: 'linear-gradient(90deg, #4599DF, #9333EA)',
                  borderRadius: 2,
                }}
              />
            </div>

            {/* Header */}
            <div style={{ padding: '24px 24px 0', textAlign: 'center' }}>
              <motion.div
                key={currentStep.id}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.3 }}
                style={{ fontSize: 48, marginBottom: 16 }}
              >
                {currentStep.icon}
              </motion.div>
              
              <motion.h2
                key={`title-${currentStep.id}`}
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: '#fff',
                  margin: 0,
                  letterSpacing: '-0.02em',
                }}
              >
                {currentStep.id === 'welcome' && userName 
                  ? `Welcome, ${userName}!` 
                  : currentStep.title}
              </motion.h2>
              
              <motion.p
                key={`subtitle-${currentStep.id}`}
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.3, delay: 0.15 }}
                style={{
                  fontSize: 14,
                  color: 'rgba(255, 255, 255, 0.5)',
                  margin: '8px 0 0',
                }}
              >
                {currentStep.subtitle}
              </motion.p>
            </div>

            {/* Content */}
            <div style={{ padding: '16px 24px' }}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStep.id}
                  initial={{ x: 20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -20, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {currentStep.content}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 24px 24px',
                borderTop: '1px solid rgba(255, 255, 255, 0.05)',
              }}
            >
              {/* Left: Skip or Back */}
              <div>
                {isFirstStep ? (
                  <button
                    onClick={handleSkip}
                    style={{
                      padding: '8px 16px',
                      background: 'transparent',
                      color: 'rgba(255, 255, 255, 0.4)',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: 13,
                      cursor: 'pointer',
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.4)')}
                  >
                    Skip Tour
                  </button>
                ) : (
                  <button
                    onClick={handleBack}
                    style={{
                      padding: '8px 16px',
                      background: 'transparent',
                      color: 'rgba(255, 255, 255, 0.6)',
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: 6,
                      fontSize: 13,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)';
                      e.currentTarget.style.color = '#fff';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
                      e.currentTarget.style.color = 'rgba(255,255,255,0.6)';
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                    Back
                  </button>
                )}
              </div>

              {/* Center: Step indicators */}
              <div style={{ display: 'flex', gap: 6 }}>
                {STEPS.map((step, index) => (
                  <div
                    key={step.id}
                    style={{
                      width: index === currentStepIndex ? 20 : 8,
                      height: 8,
                      borderRadius: 4,
                      background: index === currentStepIndex 
                        ? 'linear-gradient(90deg, #4599DF, #9333EA)' 
                        : index < currentStepIndex 
                          ? 'rgba(69, 153, 223, 0.5)' 
                          : 'rgba(255,255,255,0.2)',
                      transition: 'all 0.3s',
                    }}
                  />
                ))}
              </div>

              {/* Right: Next/Done */}
              <button
                onClick={handleNext}
                style={{
                  padding: '10px 20px',
                  background: isLastStep 
                    ? 'linear-gradient(135deg, #4599DF 0%, #9333EA 100%)' 
                    : '#fff',
                  color: isLastStep ? '#fff' : '#000',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.02)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                {isLastStep ? (
                  <>
                    Get Started
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </>
                ) : (
                  <>
                    Next
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}


