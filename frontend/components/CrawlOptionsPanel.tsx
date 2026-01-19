import React, { useState } from 'react';

export interface CrawlOptions {
  limit?: number;
  maxDepth?: number;
  includePaths?: string[];
  excludePaths?: string[];
  crawlEntireDomain?: boolean;
  sitemap?: 'only' | 'include' | 'skip';
  allowSubdomains?: boolean;
  allowExternalLinks?: boolean;
  delay?: number;
}

interface CrawlOptionsPanelProps {
  url: string;
  options: CrawlOptions;
  onChange: (options: CrawlOptions) => void;
}

// Utility function to check if URL is from a SaaS platform
function isSaaSPlatform(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const saasPatterns = [
      'notion.so',
      'notion.site',
      'github.com',
      'docs.google.com',
      'sheets.google.com',
      'linear.app',
      'airtable.com',
    ];
    return saasPatterns.some(pattern => hostname.includes(pattern));
  } catch {
    return false;
  }
}

interface TooltipProps {
  text: string;
  children: React.ReactNode;
}

function Tooltip({ text, children }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-block',
      }}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      <div
        style={{
          cursor: 'help',
          borderBottom: 'none',
        }}
      >
        {children}
      </div>
      {isVisible && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: 8,
            padding: '6px 10px',
            background: '#1a1a1a',
            border: '1px solid #2a2a2a',
            borderRadius: 4,
            fontSize: 11,
            color: '#8B8B8B',
            whiteSpace: 'nowrap',
            zIndex: 1000,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            pointerEvents: 'none',
          }}
        >
          {text}
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderBottom: '5px solid #2a2a2a',
            }}
          />
        </div>
      )}
    </div>
  );
}

export default function CrawlOptionsPanel({
  url,
  options,
  onChange,
}: CrawlOptionsPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [newIncludePath, setNewIncludePath] = useState('');
  const [newExcludePath, setNewExcludePath] = useState('');

  // Hide panel for SaaS platforms
  if (isSaaSPlatform(url)) {
    return null;
  }

  const handleChange = (key: keyof CrawlOptions, value: any) => {
    onChange({ ...options, [key]: value });
  };

  const addIncludePath = () => {
    if (newIncludePath.trim()) {
      const currentPaths = options.includePaths || [];
      handleChange('includePaths', [...currentPaths, newIncludePath.trim()]);
      setNewIncludePath('');
    }
  };

  const removeIncludePath = (index: number) => {
    const currentPaths = options.includePaths || [];
    const newPaths = currentPaths.filter((_, i) => i !== index);
    handleChange('includePaths', newPaths.length > 0 ? newPaths : undefined);
  };

  const addExcludePath = () => {
    if (newExcludePath.trim()) {
      const currentPaths = options.excludePaths || [];
      handleChange('excludePaths', [...currentPaths, newExcludePath.trim()]);
      setNewExcludePath('');
    }
  };

  const removeExcludePath = (index: number) => {
    const currentPaths = options.excludePaths || [];
    const newPaths = currentPaths.filter((_, i) => i !== index);
    handleChange('excludePaths', newPaths.length > 0 ? newPaths : undefined);
  };

  const baseInputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    background: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: 6,
    color: '#e2e8f0',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s, background 0.15s',
  };

  const baseSelectStyle: React.CSSProperties = {
    ...baseInputStyle,
    cursor: 'pointer',
    appearance: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    paddingRight: 34,
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 16 16'%3E%3Cpath d='M4 6l4 4 4-4' fill='none' stroke='%238B8B8B' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center',
    backgroundSize: '12px 12px',
  };

  return (
    <div style={{ marginTop: 20 }}>
      <style jsx>{`
        .crawlInput::placeholder {
          color: #5d6065;
          opacity: 1;
          font-family: inherit;
          font-size: inherit;
        }
        .crawlMono {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
            'Liberation Mono', 'Courier New', monospace;
        }
        /* 让 include/exclude 的占位符字体风格和其它输入一致（不要 monospace） */
        .crawlMono::placeholder {
          font-family: inherit;
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
          marginBottom: 12,
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#8B8B8B',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <svg
            width='12'
            height='12'
            viewBox='0 0 16 16'
            fill='none'
            style={{
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s',
            }}
          >
            <path
              d='M6 12L10 8L6 4'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          </svg>
          Advanced Crawl Options
        </div>
      </div>

      {/* Content */}
      {isExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Basic Settings */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#8B8B8B',
                marginBottom: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Basic Settings
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 12,
              }}
            >
              {/* Max Pages */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#8B8B8B',
                    marginBottom: 6,
                  }}
                >
                  <Tooltip text='Maximum number of pages to crawl (1-10000)'>
                    Max Pages
                  </Tooltip>
                </label>
                <input
                  type='number'
                  min='1'
                  max='10000'
                  value={options.limit ?? 100}
                  onChange={e =>
                    handleChange('limit', parseInt(e.target.value) || 100)
                  }
                  className='crawlInput'
                  style={baseInputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#444')}
                  onBlur={e => (e.currentTarget.style.borderColor = '#333')}
                />
              </div>

              {/* Crawl Depth */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#8B8B8B',
                    marginBottom: 6,
                  }}
                >
                  <Tooltip text='Maximum depth to crawl from the starting page'>
                    Crawl Depth
                  </Tooltip>
                </label>
                <input
                  type='number'
                  min='1'
                  max='10'
                  value={options.maxDepth ?? ''}
                  onChange={e =>
                    handleChange(
                      'maxDepth',
                      e.target.value ? parseInt(e.target.value) : undefined
                    )
                  }
                  placeholder='Unlimited'
                  className='crawlInput'
                  style={baseInputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#444')}
                  onBlur={e => (e.currentTarget.style.borderColor = '#333')}
                />
              </div>
            </div>
          </div>

          {/* Path Filters */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#8B8B8B',
                marginBottom: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Path Filters
            </div>

            {/* Include Paths */}
            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#8B8B8B',
                  marginBottom: 6,
                }}
              >
                <Tooltip text='URL patterns to include (e.g., /docs/, /blog/)'>
                  Include Paths
                </Tooltip>
              </label>

              {/* Path List */}
              {options.includePaths && options.includePaths.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  {options.includePaths.map((path, index) => (
                    <div
                      key={index}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 6,
                        padding: '6px 10px',
                        background: '#0a0a0a',
                        border: '1px solid #2a2a2a',
                        borderRadius: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          color: '#CDCDCD',
                          fontFamily: 'monospace',
                          flex: 1,
                        }}
                      >
                        • {path}
                      </span>
                      <button
                        onClick={() => removeIncludePath(index)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#8B8B8B',
                          cursor: 'pointer',
                          padding: '2px 6px',
                          fontSize: 16,
                          lineHeight: 1,
                          transition: 'color 0.15s',
                        }}
                        onMouseEnter={e =>
                          (e.currentTarget.style.color = '#ff6b6b')
                        }
                        onMouseLeave={e =>
                          (e.currentTarget.style.color = '#8B8B8B')
                        }
                        title='Remove'
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Path Input */}
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type='text'
                  value={newIncludePath}
                  onChange={e => setNewIncludePath(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addIncludePath();
                    }
                  }}
                  placeholder='/docs/'
                  className='crawlInput crawlMono'
                  style={{ ...baseInputStyle, flex: 1 }}
                  onFocus={e => (e.currentTarget.style.borderColor = '#444')}
                  onBlur={e => (e.currentTarget.style.borderColor = '#333')}
                />
                <button
                  onClick={addIncludePath}
                  style={{
                    background: '#2a2a2a',
                    border: 'none',
                    borderRadius: 6,
                    padding: '8px 16px',
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#CDCDCD',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e =>
                    (e.currentTarget.style.background = '#353535')
                  }
                  onMouseLeave={e =>
                    (e.currentTarget.style.background = '#2a2a2a')
                  }
                >
                  + Add
                </button>
              </div>
            </div>

            {/* Exclude Paths */}
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#8B8B8B',
                  marginBottom: 6,
                }}
              >
                <Tooltip text='URL patterns to exclude (e.g., /api/, /admin/)'>
                  Exclude Paths
                </Tooltip>
              </label>

              {/* Path List */}
              {options.excludePaths && options.excludePaths.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  {options.excludePaths.map((path, index) => (
                    <div
                      key={index}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 6,
                        padding: '6px 10px',
                        background: '#0a0a0a',
                        border: '1px solid #2a2a2a',
                        borderRadius: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          color: '#CDCDCD',
                          fontFamily: 'monospace',
                          flex: 1,
                        }}
                      >
                        • {path}
                      </span>
                      <button
                        onClick={() => removeExcludePath(index)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#8B8B8B',
                          cursor: 'pointer',
                          padding: '2px 6px',
                          fontSize: 16,
                          lineHeight: 1,
                          transition: 'color 0.15s',
                        }}
                        onMouseEnter={e =>
                          (e.currentTarget.style.color = '#ff6b6b')
                        }
                        onMouseLeave={e =>
                          (e.currentTarget.style.color = '#8B8B8B')
                        }
                        title='Remove'
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Path Input */}
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type='text'
                  value={newExcludePath}
                  onChange={e => setNewExcludePath(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addExcludePath();
                    }
                  }}
                  placeholder='/api/'
                  className='crawlInput crawlMono'
                  style={{ ...baseInputStyle, flex: 1 }}
                  onFocus={e => (e.currentTarget.style.borderColor = '#444')}
                  onBlur={e => (e.currentTarget.style.borderColor = '#333')}
                />
                <button
                  onClick={addExcludePath}
                  style={{
                    background: '#2a2a2a',
                    border: 'none',
                    borderRadius: 6,
                    padding: '8px 16px',
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#CDCDCD',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e =>
                    (e.currentTarget.style.background = '#353535')
                  }
                  onMouseLeave={e =>
                    (e.currentTarget.style.background = '#2a2a2a')
                  }
                >
                  + Add
                </button>
              </div>
            </div>
          </div>

          {/* Domain Control */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#8B8B8B',
                marginBottom: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Domain Control
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Crawl Entire Domain */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#CDCDCD',
                  cursor: 'pointer',
                }}
              >
                <input
                  type='checkbox'
                  checked={options.crawlEntireDomain ?? true}
                  onChange={e =>
                    handleChange('crawlEntireDomain', e.target.checked)
                  }
                  style={{
                    width: 16,
                    height: 16,
                    cursor: 'pointer',
                    accentColor: '#404040',
                  }}
                />
                <Tooltip text='Allow crawling all paths within the domain'>
                  Crawl Entire Domain
                </Tooltip>
              </label>

              {/* Allow Subdomains */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#CDCDCD',
                  cursor: 'pointer',
                }}
              >
                <input
                  type='checkbox'
                  checked={options.allowSubdomains ?? false}
                  onChange={e =>
                    handleChange('allowSubdomains', e.target.checked)
                  }
                  style={{
                    width: 16,
                    height: 16,
                    cursor: 'pointer',
                    accentColor: '#404040',
                  }}
                />
                <Tooltip text='Allow crawling subdomains (e.g., blog.example.com)'>
                  Allow Subdomains
                </Tooltip>
              </label>

              {/* Allow External Links */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#CDCDCD',
                  cursor: 'pointer',
                }}
              >
                <input
                  type='checkbox'
                  checked={options.allowExternalLinks ?? false}
                  onChange={e =>
                    handleChange('allowExternalLinks', e.target.checked)
                  }
                  style={{
                    width: 16,
                    height: 16,
                    cursor: 'pointer',
                    accentColor: '#404040',
                  }}
                />
                <Tooltip text='Follow links pointing to external domains'>
                  Allow External Links
                </Tooltip>
              </label>
            </div>
          </div>

          {/* Other Options */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#8B8B8B',
                marginBottom: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Other Options
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 12,
              }}
            >
              {/* Sitemap */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#8B8B8B',
                    marginBottom: 6,
                  }}
                >
                  <Tooltip text='How to use sitemap.xml for page discovery'>
                    Sitemap
                  </Tooltip>
                </label>
                <select
                  value={options.sitemap ?? 'include'}
                  onChange={e =>
                    handleChange(
                      'sitemap',
                      e.target.value as 'only' | 'include' | 'skip'
                    )
                  }
                  className='crawlInput'
                  style={baseSelectStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#444')}
                  onBlur={e => (e.currentTarget.style.borderColor = '#333')}
                >
                  <option value='include' style={{ background: '#1a1a1a' }}>
                    Include
                  </option>
                  <option value='only' style={{ background: '#1a1a1a' }}>
                    Only
                  </option>
                  <option value='skip' style={{ background: '#1a1a1a' }}>
                    Skip
                  </option>
                </select>
              </div>

              {/* Delay */}
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#8B8B8B',
                    marginBottom: 6,
                  }}
                >
                  <Tooltip text='Delay between requests in milliseconds'>
                    Delay (ms)
                  </Tooltip>
                </label>
                <input
                  type='number'
                  min='0'
                  max='10000'
                  value={options.delay ?? ''}
                  onChange={e =>
                    handleChange(
                      'delay',
                      e.target.value ? parseInt(e.target.value) : undefined
                    )
                  }
                  placeholder='0'
                  className='crawlInput'
                  style={baseInputStyle}
                  onFocus={e => (e.currentTarget.style.borderColor = '#444')}
                  onBlur={e => (e.currentTarget.style.borderColor = '#333')}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
