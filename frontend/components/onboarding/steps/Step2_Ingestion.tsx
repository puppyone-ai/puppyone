import React, { useState } from 'react';
import { WizardLayout } from '../components/WizardLayout';
import { useOnboardingStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';

// Image Icons
const IconImg = ({ src, alt }: { src: string; alt: string }) => (
  <img 
    src={src} 
    alt={alt}
    style={{ 
      display: 'inline-block', 
      verticalAlign: 'text-bottom', 
      width: 20, 
      height: 20, 
      objectFit: 'contain' 
    }} 
  />
);

const PDFIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M7 18H17V16H7V18Z" fill="#E53935" fillOpacity="0.9"/>
    <path d="M17 14H7V12H17V14Z" fill="#E53935" fillOpacity="0.9"/>
    <path d="M7 10H11V8H7V10Z" fill="#E53935" fillOpacity="0.9"/>
    <path fillRule="evenodd" clipRule="evenodd" d="M19.5 3H4.5C3.67157 3 3 3.67157 3 4.5V19.5C3 20.3284 3.67157 21 4.5 21H19.5C20.3284 21 21 20.3284 21 19.5V4.5C21 3.67157 20.3284 3 19.5 3ZM4.5 4.5H19.5V19.5H4.5V4.5Z" fill="#E53935"/>
  </svg>
);

const WebIcon = () => (
  <img src="/icons/Google_Chrome.png" alt="Web" style={{ width: 32, height: 32, objectFit: 'contain' }} />
);

const CONNECTORS = [
  { id: 'notion', label: 'Notion', icon: <IconImg src="/icons/notion.png" alt="Notion" /> },
  { id: 'linear', label: 'Linear', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="#5E6AD2"/><path d="M12 17C14.7614 17 17 14.7614 17 12C17 9.23858 14.7614 7 12 7C9.23858 7 7 9.23858 7 12C7 14.7614 9.23858 17 12 17Z" fill="#fff"/></svg> },
  { id: 'github', label: 'GitHub', icon: <IconImg src="/icons/github.svg" alt="GitHub" /> },
  { id: 'web', label: 'Website', icon: <WebIcon /> },
  { id: 'slack', label: 'Slack', icon: <IconImg src="/icons/Slack_icon_2019.svg.png" alt="Slack" /> },
  { id: 'gdocs', label: 'Google Docs', icon: <IconImg src="/icons/google-docs.svg" alt="Google Docs" /> },
];

export function Step2_Ingestion() {
  const { scenario, setStep, setDataSourceType, setDemoDataId } = useOnboardingStore();
  const [addedSources, setAddedSources] = useState<string[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const handleAddSource = (id: string) => {
    if (addedSources.includes(id)) return;
    
    // 模拟添加文件或连接
    if (id !== 'file') {
      setConnectingId(id);
      setTimeout(() => {
        setAddedSources(prev => [...prev, id]);
        setConnectingId(null);
      }, 1000);
    } else {
      // 文件上传立即"成功"（模拟）
      setAddedSources(prev => [...prev, id]);
    }
  };

  const handleConnect = (id: string) => {
    handleAddSource(id);
  };

  const handleUseDemo = () => {
    setDataSourceType('demo');
    setDemoDataId('demo-v1');
    setStep('verification');
  };

  const handleContinue = () => {
    if (addedSources.length > 0) {
      setStep('verification');
    }
  };

  if (scenario === 'coding') { // Demo 模式
    return (
      <WizardLayout title="Setting up demo environment..." subtitle="">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <div style={{ color: '#666' }}>Loading sample data...</div>
          {setTimeout(() => handleUseDemo(), 1500) && null}
        </div>
      </WizardLayout>
    );
  }

  // 对连接器进行排序：根据 scenario 推荐的排前面
  const recommendedConnectors = (() => {
    if (scenario === 'product') return ['linear', 'github', 'slack'];
    if (scenario === 'knowledge') return ['notion', 'gdocs'];
    if (scenario === 'custom') return ['web'];
    return [];
  })();

  const sortedConnectors = [...CONNECTORS].sort((a, b) => {
    const aRec = recommendedConnectors.includes(a.id);
    const bRec = recommendedConnectors.includes(b.id);
    if (aRec && !bRec) return -1;
    if (!aRec && bRec) return 1;
    return 0;
  });

  return (
    <WizardLayout 
      title="Add your data." 
      subtitle="Start by uploading files. You can connect apps later."
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 700, margin: '0 auto', width: '100%' }}>
        
        {/* Main Dropzone */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            flex: 1,
            minHeight: 300,
            border: '2px dashed #333',
            borderRadius: 16,
            background: '#111',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 20,
            cursor: 'pointer',
            transition: 'all 0.2s',
            position: 'relative',
            overflow: 'hidden'
          }}
          whileHover={{ borderColor: '#4599DF', backgroundColor: 'rgba(69, 153, 223, 0.05)' }}
          onClick={() => handleAddSource('file')}
        >
          {addedSources.includes('file') ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div style={{ 
                width: 64, height: 64, borderRadius: '50%', 
                background: 'rgba(52, 211, 153, 0.1)', color: '#34d399',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 
              }}>
                ✓
              </div>
              <div style={{ fontSize: 18, color: '#e5e5e5', fontWeight: 500 }}>Files Uploaded</div>
              <div style={{ fontSize: 14, color: '#666' }}>Click to add more</div>
            </div>
          ) : (
            <>
              <div style={{ 
                width: 80, height: 80, borderRadius: '50%', 
                background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 40, border: '1px solid #333'
              }}>
                <div style={{ transform: 'scale(1.5)' }}>
                  <PDFIcon />
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 600, color: '#e5e5e5', marginBottom: 8 }}>
                  Drop files here
                </div>
                <div style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>
                  PDF, CSV, Markdown, Text
                </div>
                
                {/* Sample File Option */}
                <div 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddSource('file'); // 模拟上传了 Sample
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    borderRadius: 6,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    fontSize: 12,
                    color: '#aaa',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                    e.currentTarget.style.color = '#fff';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                    e.currentTarget.style.color = '#aaa';
                  }}
                >
                  <span>Or try a sample PDF</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </div>
              </div>
            </>
          )}
        </motion.div>

        {/* Secondary Connectors */}
        <div style={{ marginTop: 40 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#444', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 16, textAlign: 'center' }}>
            Or connect apps
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            {sortedConnectors.map(s => {
              const isAdded = addedSources.includes(s.id);
              const isConnecting = connectingId === s.id;
              
              return (
                <motion.button
                  key={s.id}
                  whileHover={{ scale: 1.05, backgroundColor: '#222' }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleConnect(s.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 16px',
                    background: isAdded ? 'rgba(52, 211, 153, 0.1)' : '#161616',
                    border: `1px solid ${isAdded ? '#34d399' : '#333'}`,
                    borderRadius: 99,
                    color: isAdded ? '#34d399' : '#888',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 500,
                    transition: 'all 0.2s'
                  }}
                >
                  <span>{s.icon}</span>
                  <span>{isConnecting ? 'Connecting...' : (isAdded ? 'Connected' : s.label)}</span>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Continue Action */}
        <div style={{ marginTop: 40, display: 'flex', justifyContent: 'center', height: 60 }}>
          <AnimatePresence>
            {addedSources.length > 0 && (
              <motion.button
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
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
                  gap: 8
                }}
              >
                Continue ({addedSources.length})
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </motion.button>
            )}
          </AnimatePresence>
        </div>

      </div>
    </WizardLayout>
  );
}
