'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState, CSSProperties } from 'react'

interface OnboardingViewProps {
  onStart: () => void
  isLoading?: boolean
  userName?: string
}

export function OnboardingView({ onStart, isLoading = false, userName }: OnboardingViewProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

  // 鼠标跟踪
  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY })
  }

  // Stage Control
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsReady(true)
    }, 2000)
    return () => clearTimeout(timer)
  }, [])

  // 键盘回车事件 (仅当 Ready 后生效)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !isLoading && isReady) {
        setIsPressed(true)
        setTimeout(() => {
          onStart()
        }, 150)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onStart, isLoading, isReady])

  const handleStart = () => {
    if (isLoading || !isReady) return
    onStart() // 立即响应，不要延迟
  }

  // --- PuppyOne Brand Palette ---
  const colors = {
    bg: '#0A0A0A',
    gridLine: 'rgba(255,255,255,0.02)',
    textPrimary: '#E0E0E0',
    textMuted: '#555',
    accent: '#4599DF', // PuppyOne Blue
    accentAlt: '#39BC66', // PuppyOne Green
    accentGlow: 'rgba(69, 153, 223, 0.2)',
  }

  // --- Styles ---
  const containerStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    backgroundColor: colors.bg,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    overflow: 'hidden',
    zIndex: 9999,
  }

  // 基础网格背景 (暗)
  const gridStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    backgroundImage: `
      linear-gradient(${colors.gridLine} 1px, transparent 1px),
      linear-gradient(90deg, ${colors.gridLine} 1px, transparent 1px)
    `,
    backgroundSize: '60px 60px',
    pointerEvents: 'none',
    zIndex: 0,
  }

  // 高亮网格 (鼠标附近的线条变亮)
  const gridHighlightStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    backgroundImage: `
      linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)
    `,
    backgroundSize: '60px 60px',
    pointerEvents: 'none',
    zIndex: 1,
    // 用 mask 控制只在鼠标附近显示
    WebkitMaskImage: `radial-gradient(circle 150px at ${mousePos.x}px ${mousePos.y}px, white 0%, transparent 100%)`,
    maskImage: `radial-gradient(circle 150px at ${mousePos.x}px ${mousePos.y}px, white 0%, transparent 100%)`,
  }

  // 内容容器：居中，内部左对齐，固定宽度防止水平位移
  const contentBoxStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start', // 内部左对齐
    gap: 6,
    minWidth: 300, // 固定最小宽度，防止 ready 出现时整体位移
  }

  const textStyle: CSSProperties = {
    fontSize: 22,
    fontWeight: 400,
    letterSpacing: '0.01em',
    color: '#888',
    lineHeight: 1.4,
    margin: 0,
  }

  const titleStyle: CSSProperties = {
    fontSize: 22,
    fontWeight: 400,
    letterSpacing: '0.01em',
    color: colors.textPrimary,
    lineHeight: 1.4,
    margin: 0,
    display: 'flex',
    alignItems: 'baseline',
    gap: '0.3em',
  }

  // 🐾 爪子 SVG
  const PawIcon = ({ size = 18, color = "currentColor" }) => (
    <svg width={size} height={size * 0.8} viewBox="0 0 33 26" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="27.9463" cy="11.0849" rx="3.45608" ry="4.0321" transform="rotate(14 27.9463 11.0849)" fill={color}/>
      <ellipse cx="11.5129" cy="4.75922" rx="3.45608" ry="4.3201" transform="rotate(-8 11.5129 4.75922)" fill={color}/>
      <ellipse cx="20.7294" cy="4.7593" rx="3.45608" ry="4.3201" transform="rotate(8 20.7294 4.7593)" fill={color}/>
      <ellipse cx="4.32887" cy="11.0848" rx="3.45608" ry="4.0321" transform="rotate(-14 4.32887 11.0848)" fill={color}/>
      <path d="M15.4431 11.5849C15.9709 11.499 16.0109 11.4991 16.5387 11.585C17.4828 11.7388 17.9619 12.099 18.7308 12.656C20.3528 13.8309 20.0223 15.0304 21.4709 16.4048C22.2387 17.1332 23.2473 17.7479 23.9376 18.547C24.7716 19.5125 25.1949 20.2337 25.3076 21.4924C25.4028 22.5548 25.3449 23.2701 24.7596 24.1701C24.1857 25.0527 23.5885 25.4635 22.5675 25.7768C21.6486 26.0587 21.0619 25.8454 20.1014 25.7768C18.4688 25.66 17.6279 24.9515 15.9912 24.9734C14.4592 24.994 13.682 25.655 12.155 25.7768C11.1951 25.8533 10.6077 26.0587 9.68884 25.7768C8.66788 25.4635 8.07066 25.0527 7.49673 24.1701C6.91143 23.2701 6.85388 22.5546 6.94907 21.4922C7.06185 20.2335 7.57596 19.5812 8.31877 18.547C9.01428 17.5786 9.71266 17.2943 10.5109 16.4048C11.7247 15.0521 11.7621 13.7142 13.251 12.656C14.0251 12.1059 14.499 11.7387 15.4431 11.5849Z" fill={color}/>
    </svg>
  )

  // Linear × Geek Button
  const buttonStyle: CSSProperties = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 20px',
    backgroundColor: 'rgba(255,255,255,0.03)',
    backdropFilter: 'blur(12px)',
    border: `1px solid rgba(255,255,255,0.06)`,
    borderRadius: 8, // 更锐利，不是 999
    cursor: isLoading ? 'not-allowed' : 'pointer',
    transition: 'all 0.25s ease',
    boxShadow: isHovered 
      ? `0 0 0 1px ${colors.accent}40, 0 4px 20px rgba(0,0,0,0.4)`
      : '0 0 0 1px rgba(255,255,255,0.04), 0 2px 8px rgba(0,0,0,0.3)',
    transform: isHovered ? 'translateY(-1px)' : 'translateY(0)',
    zIndex: 10,
    overflow: 'hidden',
  }
  
  const buttonContainerStyle: CSSProperties = {
    height: 44,
    display: 'flex',
    alignItems: 'center',
    marginTop: 16,
  }

  return (
    <div style={containerStyle} onMouseMove={handleMouseMove}>
      {/* Grid Background - Base (dark) */}
      <div style={gridStyle} />

      {/* Grid Background - Highlight (mouse-following) */}
      <div style={gridHighlightStyle} />

      {/* Main Content - 居中容器，内部左对齐 */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={contentBoxStyle}>
          
          {/* Greeting */}
          {userName && (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              style={textStyle}
            >
              Hi, {userName}
            </motion.p>
          )}

          {/* Title */}
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            style={titleStyle}
          >
            <span>Your context is</span>
            <AnimatePresence mode="wait">
              {!isReady ? (
                <motion.span
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  style={{ color: colors.accent }}
                >
                  <motion.span
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 0.8, repeat: Infinity }}
                  >
                    _
                  </motion.span>
                </motion.span>
              ) : (
                <motion.span
                  key="ready"
                  initial={{ opacity: 0, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, filter: 'blur(0px)' }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  style={{ color: colors.accent }}
                >
                  ready.
                </motion.span>
              )}
            </AnimatePresence>
          </motion.p>

          {/* Button Container */}
          <div style={buttonContainerStyle}>
          <AnimatePresence>
            {isReady && (
              <motion.button
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
                onClick={handleStart}
                onMouseEnter={() => !isLoading && setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                style={buttonStyle}
              >
                {/* Top shine line */}
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: '1px',
                  background: `linear-gradient(90deg, transparent, rgba(255,255,255,${isHovered ? 0.3 : 0.1}), transparent)`,
                  transition: 'all 0.3s',
                }} />

                {/* 固定尺寸的图标容器，防止切换时按钮大小变化 */}
                <div style={{ width: 16, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {isLoading ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      style={{
                        width: 12,
                        height: 12,
                        border: '1.5px solid rgba(255,255,255,0.2)',
                        borderTopColor: colors.accent,
                        borderRadius: '50%',
                      }}
                    />
                  ) : (
                    <PawIcon size={16} color={isHovered ? colors.accent : '#aaa'} />
                  )}
                </div>

                <span style={{ 
                  fontSize: 13, 
                  fontWeight: 500, 
                  color: isHovered ? colors.accent : '#ccc',
                  transition: 'color 0.2s',
                  letterSpacing: '0.02em',
                }}>
                  Explore
                </span>

                {/* Terminal arrow hint */}
                <span style={{
                  marginLeft: 4,
                  fontSize: 12,
                  color: isHovered ? colors.accent : '#666',
                  fontFamily: "'JetBrains Mono', monospace",
                  transition: 'color 0.2s',
                }}>
                  →
                </span>
              </motion.button>
            )}
          </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}
