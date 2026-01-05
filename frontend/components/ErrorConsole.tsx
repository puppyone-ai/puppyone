'use client';

import { useState, useEffect, useRef } from 'react';

export type ErrorLog = {
  id: string;
  timestamp: Date;
  type: 'error' | 'warning' | 'info' | 'success';
  message: string;
};

type ErrorConsoleProps = {
  errors: ErrorLog[];
  onClear?: () => void;
  maxHeight?: number;
};

export function ErrorConsole({
  errors,
  onClear,
  maxHeight = 200,
}: ErrorConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 自动滚动到底部
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [errors]);

  const getTypeColor = (type: ErrorLog['type']) => {
    switch (type) {
      case 'error':
        return '#ef4444';
      case 'warning':
        return '#f59e0b';
      case 'info':
        return '#3b82f6';
      case 'success':
        return '#10b981';
      default:
        return '#6b7280';
    }
  };

  const getTypeLabel = (type: ErrorLog['type']) => {
    switch (type) {
      case 'error':
        return 'ERROR';
      case 'warning':
        return 'WARN';
      case 'info':
        return 'INFO';
      case 'success':
        return 'SUCCESS';
      default:
        return 'LOG';
    }
  };

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
          .error-console-scroll::-webkit-scrollbar {
            width: 8px;
          }
          .error-console-scroll::-webkit-scrollbar-track {
            background: rgba(20, 20, 24, 0.8);
          }
          .error-console-scroll::-webkit-scrollbar-thumb {
            background: rgba(48, 52, 60, 0.8);
            border-radius: 4px;
          }
          .error-console-scroll::-webkit-scrollbar-thumb:hover {
            background: rgba(60, 64, 72, 0.9);
          }
          .error-console-scroll {
            scrollbar-width: thin;
            scrollbar-color: rgba(48, 52, 60, 0.8) rgba(20, 20, 24, 0.8);
          }
        `,
        }}
      />
      <div
        style={{
          borderTop: '1px solid rgba(48,52,60,0.45)',
          background: 'rgba(10,14,18,0.95)',
          maxHeight: `${maxHeight}px`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid rgba(48,52,60,0.45)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: '#6F7580',
              textTransform: 'uppercase',
              letterSpacing: 0.6,
            }}
          >
            CONSOLE
          </div>
          {onClear && (
            <button
              onClick={onClear}
              style={{
                padding: '2px 8px',
                fontSize: 10,
                color: '#9FA4B1',
                background: 'transparent',
                border: '1px solid rgba(48,52,60,0.45)',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Clear
            </button>
          )}
        </div>
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 16px',
            fontFamily: "'JetBrains Mono', SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            minHeight: 60,
          }}
          className='error-console-scroll'
        >
          {errors.length === 0 ? (
            <div
              style={{
                color: '#6b7280',
                fontSize: 11,
                fontStyle: 'italic',
                padding: '8px 0',
              }}
            >
              No messages
            </div>
          ) : (
            errors.map(error => (
              <div
                key={error.id}
                style={{
                  marginBottom: 8,
                  padding: '6px 0',
                  borderLeft: `2px solid ${getTypeColor(error.type)}`,
                  paddingLeft: 12,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'baseline',
                    marginBottom: 4,
                  }}
                >
                  <span
                    style={{
                      color: getTypeColor(error.type),
                      fontWeight: 600,
                      fontSize: 10,
                      letterSpacing: 0.5,
                    }}
                  >
                    [{getTypeLabel(error.type)}]
                  </span>
                  <span style={{ color: '#6b7280', fontSize: 10 }}>
                    {error.timestamp.toLocaleTimeString()}
                  </span>
                </div>
                <div
                  style={{
                    color: '#e5e7eb',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {error.message}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
