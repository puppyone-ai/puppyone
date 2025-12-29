'use client'

/**
 * 统一的骨架屏组件
 * 用于 Sidebar 和 Editor 的加载状态
 */

const skeletonStyles = `
  .skeleton-item {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 28px;
  }
  .skeleton-icon {
    width: 14px;
    height: 14px;
    border-radius: 4px;
    flex-shrink: 0;
    background: rgba(255,255,255,0.06);
  }
  .skeleton-text {
    height: 10px;
    border-radius: 4px;
    background: rgba(255,255,255,0.06);
    position: relative;
    overflow: hidden;
  }
  .skeleton-text::after {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
    transform: translateX(-100%);
    animation: shimmer 1.5s infinite;
  }
  .skeleton-child { padding-left: 24px; }
  @keyframes shimmer { 100% { transform: translateX(100%); } }
`

/** Editor / Content 区域的骨架屏 */
export function EditorSkeleton() {
  return (
    <div style={{ 
      flex: 1, 
      padding: '32px 40px',
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
    }}>
      <style>{skeletonStyles}</style>
      <div className="skeleton-item">
        <div className="skeleton-icon" />
        <div className="skeleton-text" style={{ width: '30%' }} />
      </div>
      <div className="skeleton-item skeleton-child">
        <div className="skeleton-icon" />
        <div className="skeleton-text" style={{ width: '45%' }} />
      </div>
      <div className="skeleton-item" style={{ paddingLeft: '48px' }}>
        <div className="skeleton-icon" />
        <div className="skeleton-text" style={{ width: '50%' }} />
      </div>
      <div className="skeleton-item" style={{ paddingLeft: '48px' }}>
        <div className="skeleton-icon" />
        <div className="skeleton-text" style={{ width: '35%' }} />
      </div>
      <div className="skeleton-item" style={{ marginTop: 8 }}>
        <div className="skeleton-icon" />
        <div className="skeleton-text" style={{ width: '25%' }} />
      </div>
      <div className="skeleton-item skeleton-child">
        <div className="skeleton-icon" />
        <div className="skeleton-text" style={{ width: '40%' }} />
      </div>
    </div>
  )
}

