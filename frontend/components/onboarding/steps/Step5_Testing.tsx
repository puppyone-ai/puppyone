import React, { useState } from 'react';
import { WizardLayout } from '../components/WizardLayout';
import { useOnboardingStore } from '../store';
import { AnimatePresence, motion } from 'framer-motion';

interface Step5Props {
  onComplete?: () => void;
}

export function Step5_Testing({ onComplete }: Step5Props) {
  const [messages, setMessages] = useState<
    { role: 'user' | 'agent'; text: string }[]
  >([]);
  const [isTyping, setIsTyping] = useState(false);

  const handleTest = (prompt: string) => {
    setMessages(prev => [...prev, { role: 'user', text: prompt }]);
    setIsTyping(true);

    // Fake streaming
    setTimeout(() => {
      setIsTyping(false);
      setMessages(prev => [
        ...prev,
        {
          role: 'agent',
          text: `I found 5 items related to "${prompt}".\n\n1. Item A (Active)\n2. Item B (Pending)...`,
        },
      ]);
    }, 1500);
  };

  return (
    <WizardLayout
      title='Test Your Agent'
      subtitle='Verify your context API works as expected before deploying.'
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 340px',
          gap: 24,
          height: '100%',
        }}
      >
        {/* Chat Area */}
        <div
          style={{
            background: '#111',
            border: '1px solid #333',
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              flex: 1,
              padding: 20,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            {messages.length === 0 && (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#666',
                }}
              >
                Select a test case to start...
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  background: m.role === 'user' ? '#252525' : 'transparent',
                  padding: '8px 12px',
                  borderRadius: 8,
                  maxWidth: '80%',
                  fontSize: 14,
                  lineHeight: 1.5,
                }}
              >
                {m.text}
              </div>
            ))}

            {isTyping && (
              <div
                style={{ alignSelf: 'flex-start', color: '#666', fontSize: 12 }}
              >
                Agent is thinking...
              </div>
            )}
          </div>
        </div>

        {/* Test Cases */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#aaa',
              textTransform: 'uppercase',
            }}
          >
            Test Cases
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              'Summarize this context',
              'Find active items',
              'Count total records',
            ].map(prompt => (
              <button
                key={prompt}
                onClick={() => handleTest(prompt)}
                style={{
                  padding: '12px',
                  background: '#161616',
                  border: '1px solid #333',
                  borderRadius: 8,
                  textAlign: 'left',
                  color: '#ccc',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  fontSize: 13,
                }}
              >
                {prompt}
              </button>
            ))}
          </div>

          <div
            style={{
              marginTop: 'auto',
              padding: 20,
              background: 'rgba(52, 211, 153, 0.1)',
              borderRadius: 12,
              border: '1px solid rgba(52, 211, 153, 0.2)',
            }}
          >
            <div style={{ color: '#34d399', fontWeight: 600, marginBottom: 4 }}>
              Ready to Deploy
            </div>
            <div style={{ fontSize: 12, color: '#aaa', marginBottom: 16 }}>
              Your Context API is tested and ready.
            </div>
            <button
              onClick={() => onComplete?.()}
              style={{
                width: '100%',
                background: '#34d399',
                color: '#000',
                border: 'none',
                padding: '10px',
                borderRadius: 6,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Finish & Deploy
            </button>
          </div>
        </div>
      </div>
    </WizardLayout>
  );
}
