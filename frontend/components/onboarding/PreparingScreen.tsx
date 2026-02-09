'use client';

import { useState, useEffect, CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface PreparingScreenProps {
  userName?: string;
  onReady?: () => void;
  isReady?: boolean;
}

export function PreparingScreen({ userName, onReady, isReady = false }: PreparingScreenProps) {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const [isHovered, setIsHovered] = useState(false); // 手动管理 hover 状态

  useEffect(() => {
    const timer = setTimeout(() => {
      setMinTimeElapsed(true);
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  const showReady = isReady && minTimeElapsed;

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  // --- Design Tokens ---
  const colors = {
    bg: '#0A0A0A',
    gridLine: 'rgba(255,255,255,0.02)',
    textPrimary: '#EDEDED',    // 亮白
    textSecondary: '#666666',  // 灰色
    buttonBg: '#EDEDED',
    buttonText: '#0A0A0A',
  };

  return (
    <div 
      style={{
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
        cursor: 'default',
      }} 
      onMouseMove={handleMouseMove}
    >
      {/* 背景网格 */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: `linear-gradient(${colors.gridLine} 1px, transparent 1px), linear-gradient(90deg, ${colors.gridLine} 1px, transparent 1px)`,
        backgroundSize: '60px 60px',
      }} />
      
      {/* 聚光灯效果 */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: `linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)`,
        backgroundSize: '60px 60px',
        WebkitMaskImage: `radial-gradient(circle 200px at ${mousePos.x}px ${mousePos.y}px, black 0%, transparent 100%)`,
        maskImage: `radial-gradient(circle 200px at ${mousePos.x}px ${mousePos.y}px, black 0%, transparent 100%)`,
      }} />

      {/* 核心内容区 */}
      <div style={{ 
        position: 'relative', 
        zIndex: 10, 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        height: 200, 
        justifyContent: 'center'
      }}>
        
        {/* 1. Hi, username - 字号统一为 24px */}
        {userName && (
          <h1 style={{ 
            fontSize: 24,             // 统一大字号
            fontWeight: 400,          // 保持细一点
            color: colors.textSecondary, // 灰色
            margin: '0 0 8px 0',      // 紧凑一点
            letterSpacing: '-0.01em',
            opacity: 0.8,
          }}>
            Hi, {userName}
          </h1>
        )}

        {/* 2. 状态文字 - 字号统一为 24px */}
        <div style={{ position: 'relative', height: 40, width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <AnimatePresence mode="wait">
            {!showReady ? (
              <motion.div
                key="cooking"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5, transition: { duration: 0.3 } }}
                transition={{ duration: 0.5 }}
                style={{ position: 'absolute' }}
              >
                <motion.p 
                  animate={{ opacity: [0.6, 1, 0.6] }} 
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  style={{ 
                    fontSize: 24,         // 统一大字号
                    fontWeight: 500,      // 稍微粗一点
                    color: colors.textPrimary, // 亮白
                    margin: 0,
                    letterSpacing: '-0.01em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Puppy is cooking...
                </motion.p>
              </motion.div>
            ) : (
              <motion.div
                key="ready"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                style={{ position: 'absolute' }}
              >
                <p style={{ 
                  fontSize: 24,         // 统一大字号
                  fontWeight: 500,
                  color: colors.textPrimary, // 亮白
                  margin: 0,
                  letterSpacing: '-0.01em',
                  whiteSpace: 'nowrap',
                }}>
                  Your context is ready
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 3. 按钮 - 去除缩放，改为纯色变 + 阴影 */}
        <div style={{ height: 60, marginTop: 32, display: 'flex', alignItems: 'center' }}>
          <AnimatePresence>
            {showReady && onReady && (
              <motion.button
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 }}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                onClick={onReady}
                style={{
                  padding: '10px 28px',
                  fontSize: 14,
                  fontWeight: 600,
                  color: colors.buttonText,
                  backgroundColor: isHovered ? '#FFFFFF' : colors.buttonBg, // 纯色变
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: isHovered 
                    ? '0 4px 12px rgba(255, 255, 255, 0.15)' 
                    : '0 2px 4px rgba(0,0,0,0.1)',
                  transition: 'background-color 0.2s, box-shadow 0.2s',
                  transform: 'none', // 确保无缩放
                }}
              >
                <span>Enter Workspace</span>
                {/* 图标简单的位移 */}
                <motion.svg 
                  width="12" height="12" viewBox="0 0 12 12" fill="none"
                  animate={{ x: isHovered ? 3 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <path d="M2.5 6H9.5M9.5 6L6 2.5M9.5 6L6 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </motion.svg>
              </motion.button>
            )}
          </AnimatePresence>
        </div>

      </div>
    </div>
  );
}
