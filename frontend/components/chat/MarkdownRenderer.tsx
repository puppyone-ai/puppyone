import { CSSProperties, memo, useMemo, useRef } from 'react'
import ReactMarkdown, { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'

// Define default styles as a constant to avoid recreation
const DEFAULT_STYLES: Record<string, CSSProperties> = {
  p: { margin: '8px 0', lineHeight: '1.6', fontSize: '13px', wordBreak: 'break-word', overflowWrap: 'break-word' },
  h1: { fontSize: '20px', fontWeight: 700, lineHeight: '1.6', margin: '24px 0 12px 0' },
  h2: { fontSize: '16px', fontWeight: 700, lineHeight: '1.6', margin: '20px 0 10px 0' },
  h3: { fontSize: '14px', fontWeight: 600, lineHeight: '1.6', margin: '16px 0 8px 0' },
  ul: { margin: '8px 0', paddingLeft: '20px', fontSize: '13px' },
  ol: { margin: '8px 0', paddingLeft: '20px', fontSize: '13px' },
  li: { margin: '4px 0' },
  link: { color: '#4a90e2', textDecoration: 'underline', textDecorationColor: '#4a90e2', transition: 'all 0.2s ease', cursor: 'pointer', fontWeight: 500, wordBreak: 'break-word', overflowWrap: 'break-word', display: 'inline', maxWidth: '100%', fontSize: '13px' },
  table: { borderCollapse: 'collapse', width: '100%', margin: '12px 0', fontSize: '12px', border: '1px solid #3a3a3a', backgroundColor: '#1a1a1a', borderRadius: '6px', overflow: 'hidden' },
  thead: { backgroundColor: '#2a2a2a' },
  tr: { borderBottom: '1px solid #2a2a2a' },
  th: { padding: '8px 10px', textAlign: 'left', borderBottom: '2px solid #3a3a3a', borderRight: '1px solid #3a3a3a', fontWeight: 600, color: '#e0e0e0', backgroundColor: '#2a2a2a' },
  td: { padding: '6px 10px', borderBottom: '1px solid #2a2a2a', borderRight: '1px solid #2a2a2a', color: '#d2d2d2', verticalAlign: 'top' }
}

export interface MarkdownRendererProps {
  content: string
  componentsStyle?: Record<string, CSSProperties>
  onLinkEnter?: (href: string, e: React.MouseEvent) => void
  onLinkLeave?: (e: React.MouseEvent) => void
  onLinkMove?: (href: string, e: React.MouseEvent) => void
}

function MarkdownRenderer({
  content,
  componentsStyle,
  onLinkEnter,
  onLinkLeave,
  onLinkMove
}: MarkdownRendererProps) {
  // Use refs to keep handlers and styles fresh without re-rendering components
  const handlersRef = useRef({ onLinkEnter, onLinkLeave, onLinkMove })
  handlersRef.current = { onLinkEnter, onLinkLeave, onLinkMove }

  const stylesRef = useRef(componentsStyle || DEFAULT_STYLES)
  stylesRef.current = componentsStyle || DEFAULT_STYLES

  // Memoize components once. They will read from refs to get latest data.
  const components: Components = useMemo(() => {
    return {
      p: ({ children, node, ...props }) => (
        <p style={stylesRef.current.p ?? DEFAULT_STYLES.p} {...props}>{children}</p>
      ),
      h1: ({ node, ...props }) => <h1 style={stylesRef.current.h1 ?? DEFAULT_STYLES.h1} {...props} />,
      h2: ({ node, ...props }) => <h2 style={stylesRef.current.h2 ?? DEFAULT_STYLES.h2} {...props} />,
      h3: ({ node, ...props }) => <h3 style={stylesRef.current.h3 ?? DEFAULT_STYLES.h3} {...props} />,
      ul: ({ node, ...props }) => <ul style={stylesRef.current.ul ?? DEFAULT_STYLES.ul} {...props} />,
      ol: ({ node, ...props }) => <ol style={stylesRef.current.ol ?? DEFAULT_STYLES.ol} {...props} />,
      li: ({ node, ...props }) => <li style={stylesRef.current.li ?? DEFAULT_STYLES.li} {...props} />,
      table: ({ node, ...props }) => <table style={stylesRef.current.table ?? DEFAULT_STYLES.table} {...props} />,
      thead: ({ node, ...props }) => <thead style={stylesRef.current.thead ?? DEFAULT_STYLES.thead} {...props} />,
      tbody: ({ node, ...props }) => <tbody {...props} />,
      tr: ({ node, ...props }) => <tr style={stylesRef.current.tr ?? DEFAULT_STYLES.tr} {...props} />,
      th: ({ node, ...props }) => <th style={stylesRef.current.th ?? DEFAULT_STYLES.th} {...props} />,
      td: ({ node, ...props }) => <td style={stylesRef.current.td ?? DEFAULT_STYLES.td} {...props} />,
      
      a: ({ href, children, node, ...props }) => {
        const text = typeof children === 'string'
          ? children
          : Array.isArray(children) && children.length === 1 && typeof children[0] === 'string'
          ? children[0]
          : null

        const isCitation = !!text && /^\d+$/.test(text.trim())

        const handleMouseEnter = (e: React.MouseEvent) => {
            if (href && handlersRef.current.onLinkEnter) handlersRef.current.onLinkEnter(href, e)
        }
        const handleMouseLeave = (e: React.MouseEvent) => {
            if (handlersRef.current.onLinkLeave) handlersRef.current.onLinkLeave(e)
        }
        const handleMouseMove = (e: React.MouseEvent) => {
            if (href && handlersRef.current.onLinkMove) handlersRef.current.onLinkMove(href, e)
        }

        if (isCitation) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="citation-reference"
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onMouseMove={handleMouseMove}
              {...props}
            >
              {text}
            </a>
          )
        }

        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={stylesRef.current.link ?? DEFAULT_STYLES.link}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onMouseMove={handleMouseMove}
            {...props}
          >
            {children}
          </a>
        )
      }
    }
  }, [])

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={components}
    >
      {content}
    </ReactMarkdown>
  )
}

export default memo(MarkdownRenderer)
