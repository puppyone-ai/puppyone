import React from 'react';
import { motion } from 'framer-motion';
import { useOnboardingStore, OnboardingStep } from '../store';

interface WizardLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

const STEPS: OnboardingStep[] = ['scope', 'ingestion', 'verification', 'configuration', 'testing'];

export function WizardLayout({ children, title, subtitle }: WizardLayoutProps) {
  const currentStep = useOnboardingStore(s => s.currentStep);
  const currentStepIndex = STEPS.indexOf(currentStep);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      background: '#050505',
      color: '#E0E0E0',
      fontFamily: "Inter, -apple-system, sans-serif",
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <div style={{
        width: '100%',
        maxWidth: 800, // 稍微放宽一点，让进度条更舒展
        padding: '0 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 60 // 增加内容与顶部的距离
      }}>
        {/* Top Navigation - Centered Progress Only */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center',
          marginTop: 40
        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {STEPS.map((step, idx) => {
              const isCompleted = idx < currentStepIndex;
              const isCurrent = idx === currentStepIndex;
              const isFuture = idx > currentStepIndex;
              
              return (
                <React.Fragment key={step}>
                  {/* Connecting Line */}
                  {idx > 0 && (
                    <div style={{ 
                      width: 60, // 拉大间距
                      height: 1, 
                      background: isCompleted || isCurrent ? 'rgba(69, 153, 223, 0.5)' : 'rgba(255,255,255,0.1)',
                      margin: '0 12px',
                      transition: 'background 0.4s ease'
                    }} />
                  )}
                  
                  {/* Step Indicator */}
                  <div style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: isCurrent ? '#4599DF' : (isCompleted ? '#1a1a1a' : '#0A0A0A'),
                    border: `1px solid ${isCurrent ? '#4599DF' : (isCompleted ? '#4599DF' : '#333')}`,
                    color: isCurrent ? '#fff' : (isCompleted ? '#4599DF' : '#444'),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 600,
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxShadow: isCurrent ? '0 0 15px rgba(69, 153, 223, 0.3)' : 'none',
                    zIndex: 1
                  }}>
                    {isCompleted ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    ) : (
                      idx + 1
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Content Area */}
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h1 style={{ 
              fontSize: 24, // 32 -> 24
              fontWeight: 600, 
              marginBottom: 8,
              background: 'linear-gradient(to bottom, #fff, #bbb)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '-0.01em'
            }}>
              {title}
            </h1>
            {subtitle && (
              <p style={{ fontSize: 14, color: '#666', lineHeight: 1.5, maxWidth: 600, margin: '0 auto' }}>
                {subtitle}
              </p>
            )}
          </div>

          {children}
        </motion.div>
      </div>
    </div>
  );
}
