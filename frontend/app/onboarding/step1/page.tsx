'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useOnboardingStore } from '../../../components/onboarding/store';
import { RouterWizardLayout } from '../../../components/onboarding/components/RouterWizardLayout';

// Image Icons
const IconImg = ({ src, alt }: { src: string; alt: string }) => (
  <img
    src={src}
    alt={alt}
    style={{
      display: 'inline-block',
      verticalAlign: 'text-bottom',
      margin: '0 4px',
      width: 20,
      height: 20,
      objectFit: 'contain',
    }}
  />
);

// Fallback SVGs
const PDFIcon = () => <IconImg src='/icons/pdfsvg.svg' alt='PDF' />;

const WebIcon = () => <IconImg src='/icons/Google_Chrome.png' alt='Web' />;

const GDocsIcon = () => (
  <IconImg src='/icons/Google_Docs_logo.png' alt='Google Docs' />
);

const SCENARIOS = [
  {
    id: 'knowledge',
    content: (
      <span>
        My <strong>support agent</strong> needs context from <PDFIcon />,{' '}
        <IconImg src='/icons/notion.svg' alt='Notion' /> and <GDocsIcon />
      </span>
    ),
    action: 'upload',
  },
  {
    id: 'product',
    content: (
      <span>
        My <strong>dev agent</strong> needs context from{' '}
        <IconImg src='/icons/jira.png' alt='Jira' /> and{' '}
        <IconImg src='/icons/Slack_icon_2019.svg.png' alt='Slack' />.
      </span>
    ),
    action: 'connect',
  },
  {
    id: 'custom',
    content: (
      <span>
        My <strong> BI agent</strong> needs context from <WebIcon /> and{' '}
        <IconImg src='/icons/airtable.png' alt='Airtable' />.
      </span>
    ),
    action: 'crawl',
  },
  {
    id: 'start',
    content: (
      <span style={{ color: '#aaa' }}>I need to start from scratch.</span>
    ),
    action: 'demo',
  },
];

export default function Step1Page() {
  const router = useRouter();
  const { setProjectName, setScenario, setDataSourceType } =
    useOnboardingStore();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const handleSelect = (s: (typeof SCENARIOS)[0]) => {
    const nameMap: Record<string, string> = {
      knowledge: 'Knowledge Base',
      product: 'Project Context',
      custom: 'Market Intel',
      start: 'Demo Context',
    };
    setProjectName(nameMap[s.id] || 'Context');

    setScenario(s.id as any);

    if (s.action === 'upload') setDataSourceType('file');
    if (s.action === 'connect') setDataSourceType('connector');
    if (s.action === 'crawl') setDataSourceType('url');
    if (s.action === 'demo') setDataSourceType('demo');

    // Navigation via Router
    setTimeout(() => router.push('/onboarding/step2'), 200);
  };

  return (
    <RouterWizardLayout
      title='Tell us about your workflow.'
      subtitle='This helps us recommend the best sources and settings.'
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          width: '100%',
          maxWidth: 600,
          margin: '0 auto',
        }}
      >
        {SCENARIOS.map((s, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => handleSelect(s)}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
            style={{
              padding: '20px 24px',
              background: hoveredIndex === i ? '#222' : '#111',
              border: '1px solid #333',
              borderRadius: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              transition: 'background-color 0.1s',
              fontSize: 15,
              fontWeight: 400,
              color: '#ccc',
              lineHeight: 1.5,
              boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
            }}
          >
            {/* Index A/B/C/D */}
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                background: '#222',
                color: '#666',
                fontSize: 12,
                fontWeight: 600,
                marginRight: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                fontFamily: 'monospace',
              }}
            >
              {String.fromCharCode(65 + i)}
            </div>

            {s.content}
          </motion.div>
        ))}
      </div>
    </RouterWizardLayout>
  );
}
