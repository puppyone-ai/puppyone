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
        return 'var(--po-danger)';
      case 'warning':
        return 'var(--po-warning)';
      case 'info':
        return 'var(--po-accent)';
      case 'success':
        return 'var(--po-success)';
      default:
        return 'var(--po-text-subtle)';
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
            background: var(--po-inset);
          }
          .error-console-scroll::-webkit-scrollbar-thumb {
            background: var(--po-scrollbar-thumb);
            border-radius: 4px;
          }
          .error-console-scroll::-webkit-scrollbar-thumb:hover {
            background: var(--po-scrollbar-thumb-hover);
          }
          .error-console-scroll {
            scrollbar-width: thin;
            scrollbar-color: var(--po-scrollbar-thumb) var(--po-inset);
          }
        `,
        }}
      />
      <div
        style={{
          borderTop: '1px solid var(--po-border)',
          background: 'var(--po-overlay)',
          maxHeight: `${maxHeight}px`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid var(--po-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: 'var(--po-text-subtle)',
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
                color: 'var(--po-text-muted)',
                background: 'transparent',
                border: '1px solid var(--po-border)',
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
            fontFamily: "var(--po-font-sans)",
            fontSize: 11,
            minHeight: 60,
          }}
          className='error-console-scroll'
        >
          {errors.length === 0 ? (
            <div
              style={{
                color: 'var(--po-text-subtle)',
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
                  <span style={{ color: 'var(--po-text-subtle)', fontSize: 10 }}>
                    {error.timestamp.toLocaleTimeString()}
                  </span>
                </div>
                <div
                  style={{
                    color: 'var(--po-text)',
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
