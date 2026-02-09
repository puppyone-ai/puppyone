'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';

interface DemoBannerProps {
  onCreateProject?: () => void;
  onDismiss?: () => void;
}

export function DemoBanner({ onCreateProject, onDismiss }: DemoBannerProps) {
  const router = useRouter();
  const [isVisible, setIsVisible] = useState(true);

  const handleDismiss = () => {
    setIsVisible(false);
    onDismiss?.();
  };

  const handleCreateProject = () => {
    if (onCreateProject) {
      onCreateProject();
    } else {
      // Default: navigate to home with create flag
      router.push('/home?create=true');
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10, height: 0, marginBottom: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            background: 'linear-gradient(90deg, rgba(69, 153, 223, 0.15) 0%, rgba(147, 51, 234, 0.1) 50%, rgba(69, 153, 223, 0.15) 100%)',
            borderBottom: '1px solid rgba(69, 153, 223, 0.2)',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Animated gradient overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.03) 50%, transparent 100%)',
              animation: 'shimmer 3s infinite linear',
            }}
          />
          
          <style jsx>{`
            @keyframes shimmer {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(100%); }
            }
          `}</style>

          {/* Left: Icon + Message */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              position: 'relative',
              zIndex: 1,
            }}
          >
            <span
              style={{
                fontSize: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              🌱
            </span>
            <span
              style={{
                fontSize: 13,
                color: 'rgba(255, 255, 255, 0.8)',
                fontWeight: 500,
              }}
            >
              You're in the{' '}
              <span style={{ color: '#4599DF', fontWeight: 600 }}>Get Started</span>{' '}
              project. Explore the example files below.
            </span>
          </div>

          {/* Right: Actions */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              position: 'relative',
              zIndex: 1,
              flexShrink: 0,
            }}
          >
            {/* Create Project Button */}
            <button
              onClick={handleCreateProject}
              style={{
                padding: '6px 14px',
                backgroundColor: '#fff',
                color: '#000',
                border: 'none',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#e5e5e5';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#fff';
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Create My Own Project
            </button>

            {/* Dismiss Button */}
            <button
              onClick={handleDismiss}
              style={{
                padding: '6px',
                backgroundColor: 'transparent',
                color: 'rgba(255, 255, 255, 0.5)',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)';
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.5)';
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              title="Dismiss"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

