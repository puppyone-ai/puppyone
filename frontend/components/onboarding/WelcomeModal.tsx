'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  userName?: string;
}

export function WelcomeModal({ isOpen, onClose, userName }: WelcomeModalProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Delay showing modal for smooth page load
      const timer = setTimeout(() => setIsVisible(true), 300);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const features = [
    {
      icon: '🔗',
      title: 'Connect',
      description: 'Sync data from Notion, GitHub, Gmail, and more.',
    },
    {
      icon: '🤝',
      title: 'Collaborate',
      description: 'Assign different permissions to specialized Agents.',
    },
    {
      icon: '🚀',
      title: 'Distribute',
      description: 'Turn your context into actionable Tools.',
    },
  ];

  return (
    <AnimatePresence>
      {isVisible && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
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
              maxWidth: 520,
              backgroundColor: '#141414',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 16,
              padding: 0,
              zIndex: 9999,
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            }}
          >
            {/* Header with gradient */}
            <div
              style={{
                background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
                padding: '32px 32px 24px',
                position: 'relative',
              }}
            >
              {/* Decorative elements */}
              <div
                style={{
                  position: 'absolute',
                  top: 20,
                  right: 20,
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(69, 153, 223, 0.2) 0%, transparent 70%)',
                }}
              />
              
              <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>🎉</div>
                <h2
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: '#fff',
                    margin: 0,
                    letterSpacing: '-0.02em',
                  }}
                >
                  Welcome{userName ? `, ${userName}` : ''}!
                </h2>
                <p
                  style={{
                    fontSize: 14,
                    color: 'rgba(255, 255, 255, 0.6)',
                    margin: '8px 0 0',
                    lineHeight: 1.5,
                  }}
                >
                  We've created a <strong style={{ color: '#4599DF' }}>Get Started</strong> project for you to explore.
                </p>
              </div>
            </div>

            {/* Features */}
            <div style={{ padding: '24px 32px' }}>
              <p
                style={{
                  fontSize: 13,
                  color: 'rgba(255, 255, 255, 0.5)',
                  margin: '0 0 16px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  fontWeight: 600,
                }}
              >
                Here's what you can do
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {features.map((feature, index) => (
                  <motion.div
                    key={feature.title}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + index * 0.1 }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '12px 14px',
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: 10,
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                    }}
                  >
                    <span style={{ fontSize: 20 }}>{feature.icon}</span>
                    <div>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: '#fff',
                          marginBottom: 2,
                        }}
                      >
                        {feature.title}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: 'rgba(255, 255, 255, 0.5)',
                          lineHeight: 1.4,
                        }}
                      >
                        {feature.description}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '16px 32px 24px',
                borderTop: '1px solid rgba(255, 255, 255, 0.05)',
              }}
            >
              <p
                style={{
                  fontSize: 12,
                  color: 'rgba(255, 255, 255, 0.4)',
                  margin: '0 0 16px',
                  textAlign: 'center',
                }}
              >
                Feel free to break things here. It's your safe playground! 🐕
              </p>

              <button
                onClick={onClose}
                style={{
                  width: '100%',
                  padding: '12px 24px',
                  backgroundColor: '#fff',
                  color: '#000',
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#e5e5e5';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#fff';
                }}
              >
                Start Exploring
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

