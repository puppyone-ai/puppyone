import React, { useState, useEffect } from 'react';
import { WizardLayout } from '../components/WizardLayout';
import { useOnboardingStore } from '../store';
import { motion } from 'framer-motion';

// Mock Data Generators
const MOCK_DATA = {
  knowledge: {
    columns: [
      { name: 'Title', type: 'text', width: 200 },
      { name: 'Category', type: 'select', width: 120 },
      { name: 'Last Updated', type: 'date', width: 120 },
      { name: 'AI Summary', type: 'text', width: 300 },
    ],
    rows: [
      {
        title: 'Refund Policy 2024',
        category: 'Support',
        date: '2024-01-15',
        summary: 'Standard refund window is 30 days. Exceptions for...',
      },
      {
        title: 'API Authentication',
        category: 'Engineering',
        date: '2023-12-10',
        summary: 'Using OAuth2 flows for secure access...',
      },
      {
        title: 'Onboarding Guide',
        category: 'HR',
        date: '2024-02-01',
        summary: 'Steps for new employees to setup accounts...',
      },
      {
        title: 'Troubleshooting Login',
        category: 'Support',
        date: '2024-01-20',
        summary: 'Common issues with SSO and password reset...',
      },
    ],
  },
  product: {
    columns: [
      { name: 'Issue ID', type: 'text', width: 100 },
      { name: 'Status', type: 'status', width: 120 },
      { name: 'Priority', type: 'select', width: 100 },
      { name: 'Title', type: 'text', width: 300 },
    ],
    rows: [
      {
        id: 'LIN-123',
        status: 'In Progress',
        priority: 'High',
        title: 'Fix mobile navigation bug',
      },
      {
        id: 'LIN-124',
        status: 'Todo',
        priority: 'Medium',
        title: 'Update pricing page copy',
      },
      {
        id: 'LIN-125',
        status: 'Done',
        priority: 'Low',
        title: 'Refactor user profile component',
      },
      {
        id: 'LIN-126',
        status: 'In Progress',
        priority: 'High',
        title: 'Integrate Stripe payments',
      },
    ],
  },
  custom: {
    // BI/Research
    columns: [
      { name: 'Source', type: 'url', width: 150 },
      { name: 'Topic', type: 'select', width: 120 },
      { name: 'Sentiment', type: 'status', width: 100 },
      { name: 'Key Insight', type: 'text', width: 300 },
    ],
    rows: [
      {
        source: 'techcrunch.com',
        topic: 'AI Trends',
        sentiment: 'Positive',
        insight: 'Market shifting towards agentic workflows...',
      },
      {
        source: 'competitor.io',
        topic: 'Pricing',
        sentiment: 'Neutral',
        insight: 'Competitor launched a new enterprise tier...',
      },
      {
        source: 'bloomberg.com',
        topic: 'Regulation',
        sentiment: 'Negative',
        insight: 'New EU AI Act may impact data privacy...',
      },
      {
        source: 'internal_report.pdf',
        topic: 'Q3 Sales',
        sentiment: 'Positive',
        insight: 'Revenue up 15% QoQ driven by enterprise...',
      },
    ],
  },
};

export function Step3_Verification() {
  const { setStep, scenario } = useOnboardingStore();
  const [loading, setLoading] = useState(true);

  // 模拟解析过程
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  const data =
    MOCK_DATA[scenario as keyof typeof MOCK_DATA] || MOCK_DATA.knowledge;

  return (
    <WizardLayout
      title={
        loading ? 'Structuring your context...' : 'Review structured data.'
      }
      subtitle={
        loading
          ? 'AI is analyzing documents and extracting schema.'
          : 'PuppyOne automatically extracted this schema. Is it correct?'
      }
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          maxWidth: 900,
          margin: '0 auto',
          width: '100%',
        }}
      >
        {loading ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 20,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                border: '3px solid #333',
                borderTopColor: '#4599DF',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }}
            />
            <div style={{ color: '#666', fontSize: 14 }}>
              Extracting entities...
            </div>
            <style jsx>{`
              @keyframes spin {
                100% {
                  transform: rotate(360deg);
                }
              }
            `}</style>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 24,
            }}
          >
            {/* Table Preview */}
            <div
              style={{
                border: '1px solid #333',
                borderRadius: 8,
                overflow: 'hidden',
                background: '#111',
                boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: 'flex',
                  borderBottom: '1px solid #333',
                  background: '#1a1a1a',
                }}
              >
                {data.columns.map(col => (
                  <div
                    key={col.name}
                    style={{
                      width: col.width,
                      padding: '10px 12px',
                      borderRight: '1px solid #2a2a2a',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#888',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {col.name}
                    <span
                      style={{
                        fontSize: 10,
                        padding: '1px 4px',
                        borderRadius: 3,
                        background: '#252525',
                        color: '#555',
                        fontWeight: 400,
                      }}
                    >
                      {col.type}
                    </span>
                  </div>
                ))}
              </div>

              {/* Rows */}
              {data.rows.map((row, i) => (
                <div
                  key={i}
                  style={{ display: 'flex', borderBottom: '1px solid #222' }}
                >
                  {data.columns.map(col => {
                    const val = (row as any)[
                      col.name
                        .toLowerCase()
                        .replace(' ', '_')
                        .replace('id', 'id')
                    ];
                    return (
                      <div
                        key={col.name}
                        style={{
                          width: col.width,
                          padding: '10px 12px',
                          borderRight: '1px solid #222',
                          fontSize: 14,
                          color: '#ddd',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {col.type === 'status' ? (
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: 99,
                              background:
                                val === 'In Progress'
                                  ? 'rgba(59, 130, 246, 0.15)'
                                  : val === 'Done' || val === 'Positive'
                                    ? 'rgba(34, 197, 94, 0.15)'
                                    : val === 'Negative'
                                      ? 'rgba(239, 68, 68, 0.15)'
                                      : '#252525',
                              color:
                                val === 'In Progress'
                                  ? '#60A5FA'
                                  : val === 'Done' || val === 'Positive'
                                    ? '#4ADE80'
                                    : val === 'Negative'
                                      ? '#F87171'
                                      : '#aaa',
                              fontSize: 12,
                            }}
                          >
                            {val}
                          </span>
                        ) : col.type === 'url' ? (
                          <span style={{ color: '#4599DF' }}>{val}</span>
                        ) : (
                          val
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Health Check & CTA */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 'auto',
                padding: '20px 0',
              }}
            >
              <div style={{ display: 'flex', gap: 20 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 14,
                    color: '#aaa',
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: '#22c55e',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <svg
                      width='10'
                      height='10'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='black'
                      strokeWidth='4'
                    >
                      <polyline points='20 6 9 17 4 12' />
                    </svg>
                  </div>
                  Schema extracted
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 14,
                    color: '#aaa',
                  }}
                >
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: '#22c55e',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <svg
                      width='10'
                      height='10'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='black'
                      strokeWidth='4'
                    >
                      <polyline points='20 6 9 17 4 12' />
                    </svg>
                  </div>
                  Vectors indexed
                </div>
              </div>

              <button
                onClick={() => setStep('configuration')}
                style={{
                  background: '#EDEDED',
                  color: '#000',
                  border: 'none',
                  padding: '14px 48px',
                  borderRadius: 99,
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 8px 32px rgba(255,255,255,0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                Looks good
                <svg
                  width='16'
                  height='16'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='3'
                >
                  <path d='M5 12h14M12 5l7 7-7 7' />
                </svg>
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </WizardLayout>
  );
}
