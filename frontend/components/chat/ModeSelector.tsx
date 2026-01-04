import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Bot, MessageCircle } from 'lucide-react';

export type ChatMode = 'ask' | 'agent';

interface ModeSelectorProps {
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
}

const MODES: { id: ChatMode; label: string; icon: React.ReactNode }[] = [
  { id: 'agent', label: 'Agent', icon: <Bot size={12} /> },
  { id: 'ask', label: 'Chat', icon: <MessageCircle size={12} /> },
];

export default function ModeSelector({
  mode,
  onModeChange,
}: ModeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentMode = MODES.find(m => m.id === mode)!;

  return (
    <div style={{ position: 'relative' }} ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          height: '28px',
          padding: '0 8px',
          background: 'transparent',
          border: 'none',
          borderRadius: '6px',
          color: '#9ca3af',
          fontSize: '12px',
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'color 0.2s, background 0.2s',
        }}
        onMouseEnter={e => {
          if (!isOpen) {
            e.currentTarget.style.color = '#e2e8f0';
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          }
        }}
        onMouseLeave={e => {
          if (!isOpen) {
            e.currentTarget.style.color = '#9ca3af';
            e.currentTarget.style.background = 'transparent';
          }
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center' }}>
          {currentMode.icon}
        </span>
        <span>{currentMode.label}</span>
        <ChevronDown size={14} style={{ opacity: 0.7 }} />
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: '8px',
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: '10px',
            padding: '4px',
            minWidth: '140px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          {MODES.map(opt => (
            <button
              key={opt.id}
              onClick={() => {
                onModeChange(opt.id);
                setIsOpen(false);
              }}
              style={{
                width: '100%',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '0 12px',
                background:
                  mode === opt.id ? 'rgba(52, 211, 153, 0.1)' : 'transparent',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.15s',
                color: mode === opt.id ? '#e2e8f0' : '#888',
              }}
              onMouseEnter={e => {
                if (mode !== opt.id)
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              }}
              onMouseLeave={e => {
                if (mode !== opt.id)
                  e.currentTarget.style.background = 'transparent';
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  color: mode === opt.id ? '#34d399' : 'currentColor',
                }}
              >
                {opt.icon}
              </span>
              <div style={{ flex: 1, fontSize: '12px', fontWeight: 500 }}>
                {opt.label}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
