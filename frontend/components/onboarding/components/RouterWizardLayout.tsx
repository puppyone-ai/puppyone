'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { usePathname } from 'next/navigation';

interface RouterWizardLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

const STEPS = [
  '/onboarding/step1',
  '/onboarding/step2',
  '/onboarding/step3',
];

export function RouterWizardLayout({ children, title, subtitle }: RouterWizardLayoutProps) {
  const pathname = usePathname();
  
  // Find current step index based on pathname prefix match
  const currentStepIndex = STEPS.findIndex(step => pathname?.startsWith(step));
  
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh',
      width: '100vw',
      background: '#050505',
      color: '#E0E0E0',
      fontFamily: "Inter, -apple-system, sans-serif",
      overflowX: 'hidden',
      overflowY: 'auto',
      alignItems: 'center',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 800,
        padding: '60px 20px 80px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 48
      }}>
        {/* Top Navigation - Centered Progress Only */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center',
          marginTop: 0, // margin-top 不再需要，由外层 padding 控制
        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            
            {STEPS.map((step, idx) => {
              const isCompleted = idx < currentStepIndex;
              const isCurrent = idx === currentStepIndex;
              
              return (
                <React.Fragment key={step}>
                  {/* Connecting Line (Only between steps) */}
                  {idx > 0 && (
                    <div style={{ 
                      width: 60,
                      height: 2,
                      background: isCompleted || isCurrent ? '#EDEDED' : '#222',
                      transition: 'background 0.4s ease'
                    }} />
                  )}
                  
                  {/* Step Circle */}
                  <div style={{ 
                    position: 'relative', 
                    zIndex: 2,
                  }}>
                    <motion.div
                      initial={false}
                      animate={{
                        backgroundColor: isCompleted || isCurrent ? '#EDEDED' : '#111',
                        borderColor: isCompleted || isCurrent ? '#EDEDED' : '#333',
                        color: isCompleted || isCurrent ? '#000' : '#666',
                        scale: isCurrent ? 1.1 : 1
                      }}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        border: '2px solid',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'default',
                        boxShadow: isCurrent ? '0 0 0 4px rgba(255,255,255,0.1)' : 'none'
                      }}
                    >
                      {isCompleted ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      ) : (
                        idx + 1
                      )}
                    </motion.div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Content Area */}
        <motion.div
          key={pathname} // Use pathname as key to trigger transition on route change
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h1 style={{ 
              fontSize: 24,
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
