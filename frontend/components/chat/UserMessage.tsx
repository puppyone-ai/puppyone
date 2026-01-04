import { Copy, Check } from 'lucide-react';
import { CSSProperties, useState, useEffect } from 'react';
import MarkdownRenderer from './MarkdownRenderer';

// Types
interface Message {
  content: string;
  timestamp?: Date;
}

export interface UserMessageProps {
  message: Message;
  showAvatar?: boolean;
  showBorder?: boolean;
  isTyping?: boolean;
}

const StyleManager = {
  injected: new Set<string>(),
  inject(id: string, css: string) {
    if (typeof document === 'undefined') return;
    if (this.injected.has(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
    this.injected.add(id);
  },
};

export default function UserMessage({
  message,
  showAvatar = true,
  showBorder = true,
  isTyping = false,
}: UserMessageProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    StyleManager.inject(
      'puppychat-pulse-animation',
      `
      @keyframes pulse {
        0%, 80%, 100% { transform: scale(0.8); opacity: 0.5; }
        40% { transform: scale(1); opacity: 1; }
      }
    `
    );
  }, []);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message.content);
      } else if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = message.content;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const styles: { [key: string]: CSSProperties } = {
    container: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '0px',
      width: '100%',
      flexDirection: 'row-reverse',
    },
    messageWrapper: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      maxWidth: '85%',
    },
    bubble: {
      padding: '4px 10px',
      borderRadius: '12px',
      boxShadow: 'none',
      position: 'relative',
      background: '#1e1e1e',
      color: '#dcdcdc',
      border: 'none',
      cursor: 'default',
    },
    content: {
      fontSize: '13px',
      whiteSpace: 'normal',
      lineHeight: '1.5',
      margin: 0,
      textAlign: 'left',
    },
    h1: {
      fontSize: '20px',
      fontWeight: 700,
      lineHeight: '1.6',
      margin: '24px 0 12px 0',
    },
    h2: {
      fontSize: '16px',
      fontWeight: 700,
      lineHeight: '1.6',
      margin: '20px 0 10px 0',
    },
    h3: {
      fontSize: '14px',
      fontWeight: 600,
      lineHeight: '1.6',
      margin: '16px 0 8px 0',
    },
    table: {
      borderCollapse: 'collapse',
      width: '100%',
      margin: '12px 0',
      fontSize: '12px',
      border: '1px solid #3a3a3a',
      backgroundColor: '#1a1a1a',
      borderRadius: '6px',
      overflow: 'hidden',
    },
    thead: { backgroundColor: '#2a2a2a' },
    th: {
      padding: '10px 12px',
      textAlign: 'left',
      borderBottom: '2px solid #3a3a3a',
      borderRight: '1px solid #3a3a3a',
      fontWeight: 600,
      color: '#e0e0e0',
      backgroundColor: '#2a2a2a',
    },
    td: {
      padding: '8px 12px',
      borderBottom: '1px solid #2a2a2a',
      borderRight: '1px solid #2a2a2a',
      color: '#dcdcdc',
      verticalAlign: 'top',
    },
    tr: {
      borderBottom: '1px solid #2a2a2a',
    },
    metaBar: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginTop: '4px',
      opacity: isHovered ? 0.6 : 0,
      transition: 'opacity 0.2s ease',
      justifyContent: 'flex-end',
    },
    timestamp: { fontSize: '12px', color: '#a0a0a0' },
    copyButton: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '20px',
      height: '20px',
      borderRadius: '4px',
      color: '#a0a0a0',
      cursor: 'pointer',
    },
    typingDots: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      height: '20px',
    },
    dot: {
      width: '8px',
      height: '8px',
      backgroundColor: '#4a90e2',
      borderRadius: '50%',
      animation: 'pulse 1s infinite',
    },
  };

  return (
    <div style={styles.container}>
      <div
        style={styles.messageWrapper}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div style={styles.bubble}>
          {isTyping ? (
            <div style={styles.typingDots}>
              <div style={{ ...styles.dot, animationDelay: '0s' }}></div>
              <div style={{ ...styles.dot, animationDelay: '0.3s' }}></div>
              <div style={{ ...styles.dot, animationDelay: '0.6s' }}></div>
            </div>
          ) : (
            <div style={styles.content}>
              <MarkdownRenderer
                content={(message.content || '')
                  .replace(/\r\n/g, '\n')
                  .replace(/\n{3,}/g, '\n\n')}
                componentsStyle={{
                  p: { margin: '4px 0', lineHeight: '1.5' },
                  h1: styles.h1,
                  h2: styles.h2,
                  h3: styles.h3,
                  ul: { margin: '8px 0', paddingLeft: '20px' },
                  ol: { margin: '8px 0', paddingLeft: '20px' },
                  li: { margin: '4px 0' },
                  table: styles.table,
                  thead: styles.thead,
                  tr: styles.tr,
                  th: styles.th,
                  td: styles.td,
                }}
              />
            </div>
          )}
        </div>

        {!isTyping && (
          <div style={styles.metaBar}>
            <div style={styles.timestamp}>
              {message.timestamp
                ? message.timestamp.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : ''}
            </div>
            <div
              style={styles.copyButton}
              title={copied ? 'Copied' : 'Copy message'}
              onClick={handleCopy}
            >
              {copied ? (
                <div
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    backgroundColor: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Check
                    style={{ width: '12px', height: '12px', color: '#000000' }}
                  />
                </div>
              ) : (
                <Copy style={{ width: '14px', height: '14px' }} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
