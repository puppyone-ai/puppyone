import React from 'react';
import { WizardLayout } from '../components/WizardLayout';
import { useOnboardingStore } from '../store';
import { motion } from 'framer-motion';

export function Step2_Ingestion() {
  const { setStep, dataSourceType, scenario } = useOnboardingStore();

  const handleContinue = () => {
    setStep('verification');
  };

  const handleBack = () => {
    setStep('scope');
  };

  return (
    <WizardLayout 
      title="Add your data sources"
      subtitle="Upload files, connect apps, or enter URLs to ingest."
    >
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: 24, 
          width: '100%', 
          maxWidth: 600, 
          margin: '0 auto' 
        }}
      >
        {/* Placeholder content based on data source type */}
        <div style={{
          padding: 40,
          background: '#111',
          border: '2px dashed #333',
          borderRadius: 12,
          textAlign: 'center',
          color: '#666',
          fontSize: 14,
        }}>
          {dataSourceType === 'file' && (
            <div>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
              <div>Drag and drop files here, or click to browse</div>
            </div>
          )}
          {dataSourceType === 'connector' && (
            <div>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔗</div>
              <div>Connect your apps (Notion, Jira, Slack, etc.)</div>
            </div>
          )}
          {dataSourceType === 'url' && (
            <div>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🌐</div>
              <div>Enter URLs to crawl</div>
            </div>
          )}
          {dataSourceType === 'demo' && (
            <div>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✨</div>
              <div>Loading demo data...</div>
            </div>
          )}
          {!dataSourceType && (
            <div>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📥</div>
              <div>Select a data source type</div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginTop: 20 
        }}>
          <button
            onClick={handleBack}
            style={{
              background: 'transparent',
              color: '#888',
              border: '1px solid #333',
              padding: '12px 24px',
              borderRadius: 99,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            ← Back
          </button>

          <button
            onClick={handleContinue}
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
            Continue
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </motion.div>
    </WizardLayout>
  );
}
