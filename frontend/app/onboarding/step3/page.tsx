'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { useOnboardingStore } from '../../../components/onboarding/store';
import { RouterWizardLayout } from '../../../components/onboarding/components/RouterWizardLayout';
import { getApiAccessToken } from '../../../lib/apiClient';

// Spinner Icon
const Spinner = ({ size = 20 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
  >
    <circle cx='12' cy='12' r='10' strokeOpacity='0.25' />
    <path
      d='M12 2a10 10 0 0 1 10 10'
      style={{
        animation: 'spin 1s linear infinite',
        transformOrigin: 'center',
      }}
    />
    <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
  </svg>
);

// Icons
const SandboxIcon = ({ size = 24 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    fill='none'
    stroke='currentColor'
    viewBox='0 0 24 24'
    style={{ opacity: 0.8 }}
  >
    <path
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth={1.5}
      d='M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z'
    />
  </svg>
);

const SkillIcon = ({ size = 20 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    fill='none'
    stroke='currentColor'
    viewBox='0 0 24 24'
    style={{ opacity: 0.8 }}
  >
    <polygon
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth={1.5}
      points='12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'
    />
  </svg>
);

// --- TOOL SKELETON ---
const ToolSkeleton = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 14px',
      borderRadius: 8,
      border: '1px solid #222',
      background: '#111',
      height: 60,
      position: 'relative',
      overflow: 'hidden',
    }}
  >
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 6,
        background: '#1a1a1a',
        flexShrink: 0,
      }}
    />
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        width: '100%',
      }}
    >
      <div
        style={{
          height: 10,
          width: 120,
          background: '#1a1a1a',
          borderRadius: 4,
        }}
      />
      <div
        style={{ height: 8, width: 80, background: '#1a1a1a', borderRadius: 4 }}
      />
    </div>
  </div>
);

// --- TOOL CARD ---
interface ToolData {
  type: 'MCP' | 'SANDBOX' | 'SKILL';
  title: string;
  code: string;
  color: string;
}

const ToolCard = ({ tool }: { tool: ToolData }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 14px',
      borderRadius: 8,
      border: '1px solid #333',
      background: '#111',
      position: 'relative',
      overflow: 'hidden',
      height: 60,
    }}
  >
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 6,
        background: '#1a1a1a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        border: '1px solid #333',
      }}
    >
      {tool.type === 'MCP' && (
        <Image
          src='/icons/mcp.png'
          alt='MCP'
          width={16}
          height={16}
          style={{ opacity: 0.8 }}
        />
      )}
      {tool.type === 'SANDBOX' && (
        <span style={{ color: '#27C93F' }}>
          <SandboxIcon size={18} />
        </span>
      )}
      {tool.type === 'SKILL' && (
        <span style={{ color: '#A78BFA' }}>
          <SkillIcon size={16} />
        </span>
      )}
    </div>

    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 1,
        width: '100%',
        minWidth: 0,
        alignItems: 'flex-start',
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            fontFamily: 'monospace',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            flexShrink: 0,
            color: tool.color,
          }}
        >
          {tool.type}
        </span>
        <span
          style={{
            color: '#eee',
            fontWeight: 700,
            fontSize: 12,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {tool.title}
        </span>
      </div>
      <span
        style={{
          fontSize: 10,
          color: '#666',
          fontFamily: 'monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {tool.code}
      </span>
    </div>
  </div>
);

// --- CODE LINE ---
interface CodeLineData {
  text: string;
  indent: number;
  key?: string;
  color: string;
}

const CodeLine = ({ line }: { line: CodeLineData }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      height: 20,
      fontFamily: 'SF Mono, Monaco, Consolas, monospace',
      fontSize: 11,
      lineHeight: '20px',
      paddingLeft: line.indent * 14 + 20,
    }}
  >
    <span style={{ color: line.color }}>
      {line.key && <span style={{ color: '#9CDCFE' }}>"{line.key}"</span>}
      {line.key && <span style={{ color: '#d4d4d4' }}>: </span>}
      {!line.key && line.text}
      {line.key && line.text.replace(`"${line.key}": `, '')}
    </span>
  </div>
);

// --- MOCK DATA ---
const CODE_LINES: CodeLineData[] = [
  { text: '{', indent: 0, color: '#d4d4d4' },
  { text: '"datasets": [', indent: 1, key: 'datasets', color: '#d4d4d4' },
  { text: '{', indent: 2, color: '#d4d4d4' },
  { text: '"id": "ds_2991",', indent: 3, color: '#9CDCFE' },
  { text: '"type": "financial_report",', indent: 3, color: '#CE9178' },
  { text: '"rows": 45000,', indent: 3, color: '#B5CEA8' },
  { text: '},', indent: 2, color: '#d4d4d4' },
  { text: '{', indent: 2, color: '#d4d4d4' },
  { text: '"id": "ds_2992",', indent: 3, color: '#9CDCFE' },
  { text: '"type": "user_churn",', indent: 3, color: '#CE9178' },
  { text: '}', indent: 2, color: '#d4d4d4' },
  { text: '],', indent: 1, color: '#d4d4d4' },
  { text: '"schema": {', indent: 1, key: 'schema', color: '#d4d4d4' },
  { text: '"analysis_ready": true,', indent: 2, color: '#9CDCFE' },
  { text: '"vector_index": "v_fin_q4"', indent: 2, color: '#CE9178' },
  { text: '}', indent: 1, color: '#d4d4d4' },
  { text: '}', indent: 0, color: '#d4d4d4' },
];

const TOOLS: ToolData[] = [
  {
    type: 'MCP',
    title: 'Query Financials',
    code: 'select_revenue(quarter)',
    color: '#4ECDC4',
  },
  {
    type: 'SANDBOX',
    title: 'Run Python Analysis',
    code: 'exec_python(script)',
    color: '#27C93F',
  },
  {
    type: 'SKILL',
    title: 'Generate PDF Report',
    code: 'compile_report(data)',
    color: '#A78BFA',
  },
];

const SUGGESTED_QUESTIONS = [
  'What is the return policy?',
  'How do I reset my password?',
  'Summarize the key points.',
];

const MOCK_ANSWER =
  'Based on the context provided, here is the information you requested. The document outlines the core architecture and key features of the system. It emphasizes modularity and scalability.';

// --- MAIN COMPONENT ---
export default function Step3Page() {
  const router = useRouter();
  const { uploadedFiles, connectedApps, enteredUrls } = useOnboardingStore();

  const [stage, setStage] = useState<'parsing' | 'building' | 'ready'>(
    'parsing'
  );
  const [visibleLines, setVisibleLines] = useState(0);
  const [toolStates, setToolStates] = useState<
    ('hidden' | 'loading' | 'visible')[]
  >(['hidden', 'hidden', 'hidden']);

  const [messages, setMessages] = useState<
    { role: 'user' | 'assistant'; content: string }[]
  >([]);
  const [isTyping, setIsTyping] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Animation Sequence
  useEffect(() => {
    const runSequence = async () => {
      // 1. Parsing Phase (Code typing)
      setStage('parsing');

      // Let code type out partially
      await new Promise(r => setTimeout(r, 1200));

      // 2. Building Phase (Sequential Tool Loading)
      setStage('building');

      // Tool 1
      setToolStates(['loading', 'hidden', 'hidden']);
      await new Promise(r => setTimeout(r, 600));
      setToolStates(['visible', 'hidden', 'hidden']);

      // Tool 2
      await new Promise(r => setTimeout(r, 200));
      setToolStates(['visible', 'loading', 'hidden']);
      await new Promise(r => setTimeout(r, 600));
      setToolStates(['visible', 'visible', 'hidden']);

      // Tool 3
      await new Promise(r => setTimeout(r, 200));
      setToolStates(['visible', 'visible', 'loading']);
      await new Promise(r => setTimeout(r, 600));
      setToolStates(['visible', 'visible', 'visible']);

      // 3. Ready Phase
      setStage('ready');
    };

    runSequence();
  }, []);

  // Code typing animation logic
  useEffect(() => {
    // Start typing immediately
    const interval = setInterval(() => {
      setVisibleLines(prev => {
        if (prev < CODE_LINES.length) return prev + 1;
        clearInterval(interval);
        return prev;
      });
    }, 40); // Typing speed
    return () => clearInterval(interval);
  }, []);

  const handleSend = async (text: string) => {
    if (!text.trim() || isTyping) return;
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setIsTyping(true);
    await new Promise(resolve =>
      setTimeout(resolve, 800 + Math.random() * 800)
    );
    setMessages(prev => [...prev, { role: 'assistant', content: MOCK_ANSWER }]);
    setIsTyping(false);
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  return (
    <RouterWizardLayout
      title={
        stage === 'ready'
          ? 'Your context space is ready.'
          : 'Building context space...'
      }
      subtitle={
        stage === 'ready'
          ? "We've mapped your data to agent interfaces."
          : 'Indexing content and deploying tools.'
      }
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          maxWidth: 1000,
          margin: '0 auto',
          width: '100%',
          gap: 48,
        }}
      >
        {/* ========= MAIN TERMINAL CONTAINER ========= */}
        <div
          style={{
            width: '100%',
            height: 540,
            borderRadius: 12,
            border: '1px solid #333',
            background: '#080808',
            display: 'grid',
            gridTemplateColumns: '1fr 1px 1fr',
            gridTemplateRows: '36px 1fr',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          }}
        >
          {/* Header Left */}
          <div
            style={{
              background: '#111',
              borderBottom: '1px solid #333',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 11,
                fontFamily: 'monospace',
                color: '#666',
              }}
            >
              <span style={{ opacity: 0.3 }}>====</span>
              <span style={{ color: '#888', fontWeight: 700 }}>
                CONTEXT BASE
              </span>
              <span style={{ opacity: 0.3 }}>====</span>
            </div>
          </div>

          {/* Header Divider (Grid Column 2) */}
          <div style={{ background: '#333' }}></div>

          {/* Header Right */}
          <div
            style={{
              background: '#111',
              borderBottom: '1px solid #333',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 11,
                fontFamily: 'monospace',
                color: '#666',
              }}
            >
              <span style={{ opacity: 0.3 }}>====</span>
              <span style={{ color: '#888', fontWeight: 700 }}>
                TOOLS FOR AGENTS
              </span>
              <span style={{ opacity: 0.3 }}>====</span>
            </div>
          </div>

          {/* Body Left: Context Base */}
          <div
            style={{
              background: '#080808',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                padding: 24,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'relative',
                  zIndex: 0,
                }}
              >
                {CODE_LINES.slice(0, visibleLines).map((line, i) => (
                  <CodeLine key={i} line={line} />
                ))}
              </div>
            </div>
          </div>

          {/* Body Divider (Grid Column 2) */}
          <div style={{ background: '#333' }}></div>

          {/* Body Right: Tools for Agents */}
          <div
            style={{
              background: '#0b0b0d',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: '0 48px',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                width: '100%',
              }}
            >
              {/* Tool Slots - Standard Flex Column */}
              {[0, 1, 2].map(idx => (
                <div key={idx} style={{ width: '100%' }}>
                  {toolStates[idx] === 'loading' ? (
                    <ToolSkeleton />
                  ) : toolStates[idx] === 'visible' && TOOLS[idx] ? (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <ToolCard tool={TOOLS[idx]} />
                    </motion.div>
                  ) : (
                    // Placeholder to maintain layout stability
                    <div style={{ height: 60 }} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ========= TEST SECTION ========= */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
          }}
        >
          {!showTest ? (
            <button
              onClick={() => setShowTest(true)}
              disabled={stage !== 'ready'}
              style={{
                background: 'transparent',
                border: '1px solid #333',
                color: stage === 'ready' ? '#888' : '#444',
                padding: '10px 24px',
                borderRadius: 99,
                fontSize: 13,
                cursor: stage === 'ready' ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                opacity: stage === 'ready' ? 1 : 0.5,
              }}
              onMouseEnter={e => {
                if (stage === 'ready') {
                  e.currentTarget.style.borderColor = '#555';
                  e.currentTarget.style.color = '#ccc';
                }
              }}
              onMouseLeave={e => {
                if (stage === 'ready') {
                  e.currentTarget.style.borderColor = '#333';
                  e.currentTarget.style.color = '#888';
                }
              }}
            >
              <SandboxIcon size={14} />
              Test your context now ↓
            </button>
          ) : (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              style={{
                width: '100%',
                maxWidth: 700,
                background: '#0a0a0a',
                border: '1px solid #222',
                borderRadius: 16,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  padding: '12px 20px',
                  borderBottom: '1px solid #1a1a1a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#888',
                      textTransform: 'uppercase',
                    }}
                  >
                    Quick Test
                  </span>
                  <span style={{ fontSize: 12, color: '#444' }}>•</span>
                  <span style={{ fontSize: 12, color: '#666' }}>
                    Sandbox Environment
                  </span>
                </div>
                <span
                  onClick={() => setShowTest(false)}
                  style={{ fontSize: 18, cursor: 'pointer', color: '#666' }}
                >
                  ×
                </span>
              </div>

              <div
                style={{
                  padding: 20,
                  minHeight: 200,
                  maxHeight: 400,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                }}
              >
                {messages.length === 0 ? (
                  <div
                    style={{
                      marginTop: 20,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                      alignItems: 'center',
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 13, color: '#666' }}>
                      Ask a question to verify your context:
                    </p>
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        flexWrap: 'wrap',
                        justifyContent: 'center',
                      }}
                    >
                      {SUGGESTED_QUESTIONS.map((q, i) => (
                        <button
                          key={i}
                          onClick={() => handleSend(q)}
                          style={{
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid #222',
                            borderRadius: 20,
                            padding: '8px 16px',
                            color: '#ccc',
                            fontSize: 13,
                            cursor: 'pointer',
                          }}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messages.map((msg, i) => (
                    <div
                      key={i}
                      style={{
                        alignSelf:
                          msg.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '85%',
                      }}
                    >
                      <div
                        style={{
                          padding: '10px 14px',
                          borderRadius: 12,
                          fontSize: 13,
                          lineHeight: 1.5,
                          background:
                            msg.role === 'user' ? '#222' : 'transparent',
                          color: msg.role === 'user' ? '#fff' : '#ccc',
                        }}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))
                )}
                {isTyping && (
                  <div style={{ fontSize: 12, color: '#555', paddingLeft: 14 }}>
                    Writing...
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            </motion.div>
          )}
        </div>

        {/* ========= FOOTER ACTION ========= */}
        <div
          style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}
        >
          <button
            onClick={() => router.push('/projects')}
            disabled={stage !== 'ready'}
            style={{
              background: stage === 'ready' ? '#EDEDED' : '#222',
              color: stage === 'ready' ? '#000' : '#555',
              border: 'none',
              padding: '12px 32px',
              borderRadius: 99,
              fontSize: 14,
              fontWeight: 600,
              cursor: stage === 'ready' ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.3s',
            }}
          >
            Go to Dashboard
            <svg
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
            >
              <path d='M5 12h14M12 5l7 7-7 7' />
            </svg>
          </button>
        </div>
      </div>
    </RouterWizardLayout>
  );
}
