import React, { useState } from 'react';
import { WizardLayout } from '../components/WizardLayout';
import { useOnboardingStore, ScenarioType } from '../store';
import { motion } from 'framer-motion';

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
      objectFit: 'contain' 
    }} 
  />
);

// Fallback SVGs
const PDFIcon = () => (
  <IconImg src="/icons/pdfsvg.svg" alt="PDF" />
);

const WebIcon = () => (
  <IconImg src="/icons/Google_Chrome.png" alt="Web" />
);

const GDocsIcon = () => (
  <IconImg src="/icons/Google_Docs_logo.png" alt="Google Docs" />
);

const MagicIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'text-bottom', margin: '0 4px' }}>
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
  </svg>
);

const SCENARIOS = [
  { 
    id: 'knowledge',
    content: (
      <span>
        My <strong>support agent</strong> needs context from <PDFIcon />, <IconImg src="/icons/notion.svg" alt="Notion" />  and <GDocsIcon /> 
      </span>
    ),
    action: 'upload'
  },
  { 
    id: 'product', 
    content: (
      <span>
        My <strong>dev agent</strong> needs context from  <IconImg src="/icons/jira.png" alt="Jira" /> and <IconImg src="/icons/Slack_icon_2019.svg.png" alt="Slack" />.
      </span>
    ),
    action: 'connect'
  },
  { 
    id: 'custom', 
    content: (
      <span>
        My <strong> BI agent</strong> needs context from <WebIcon /> and <IconImg src="/icons/airtable.png" alt="Airtable" />.
      </span>
    ),
    action: 'crawl'
  },
  { 
    id: 'start', 
    content: (
      <span style={{ color: '#aaa' }}>
        I need to start from scratch.
      </span>
    ),
    action: 'demo'
  }
];

export function Step1_Scope() {
  const { setProjectName, setScenario, setStep, setDataSourceType } = useOnboardingStore();

  const handleSelect = (s: typeof SCENARIOS[0]) => {
    const nameMap: Record<string, string> = {
      'knowledge': 'Knowledge Base',
      'product': 'Project Context',
      'custom': 'Market Intel',
      'start': 'Demo Context'
    };
    setProjectName(nameMap[s.id] || 'Context'); 
    
    setScenario(s.id as any);
    
    if (s.action === 'upload') setDataSourceType('file');
    if (s.action === 'connect') setDataSourceType('connector');
    if (s.action === 'crawl') setDataSourceType('url');
    if (s.action === 'demo') setDataSourceType('demo');

    setTimeout(() => setStep('ingestion'), 200);
  };

  return (
    <WizardLayout 
      title="What context do your AI agents need?" 
      subtitle="Build a unified knowledge layer for your tools."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 600, margin: '0 auto' }}>
        {SCENARIOS.map((s, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            whileHover={{ scale: 1.01, backgroundColor: 'rgba(255,255,255,0.05)' }}
            whileTap={{ scale: 0.99 }}
            onClick={() => handleSelect(s)}
            style={{
              padding: '20px 24px',
              background: '#111',
              border: '1px solid #333',
              borderRadius: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              transition: 'border-color 0.2s',
              fontSize: 15,
              fontWeight: 400,
              color: '#ccc',
              lineHeight: 1.5,
              boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#555'}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#333'}
          >
            {/* 增加一个选中指示器 */}
            <div style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: '1px solid #444',
              marginRight: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }} />
            
            {s.content}
          </motion.div>
        ))}
      </div>
    </WizardLayout>
  );
}
