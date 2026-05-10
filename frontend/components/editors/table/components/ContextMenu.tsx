'use client';

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
  CSSProperties,
} from 'react';

// ============================================
// Types
// ============================================
type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  path: string;
  value: JsonValue;
  anchorElement?: HTMLElement | null; // 触发菜单的元素，用于滚动时更新位置
  offsetX?: number; // 相对于 anchor 元素的 X 偏移
  offsetY?: number; // 相对于 anchor 元素的 Y 偏移
  align?: 'left' | 'right'; // 对齐方式，right 表示菜单主体向左延伸（transform: translateX(-100%)）
}

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onAction: (action: string, payload?: any) => void;
}

// ============================================
// Utils
// ============================================
function getTypeInfo(value: JsonValue): { type: string; color: string } {
  if (value === null) return { type: 'null', color: '#6b7280' };
  if (typeof value === 'string') return { type: 'string', color: '#e2e8f0' };
  if (typeof value === 'number') return { type: 'number', color: '#c084fc' };
  if (typeof value === 'boolean') return { type: 'boolean', color: '#fb7185' };
  if (Array.isArray(value)) return { type: 'array', color: '#fbbf24' };
  if (typeof value === 'object') return { type: 'object', color: '#34d399' };
  return { type: 'unknown', color: '#9ca3af' };
}

// ============================================
// Styles
// ============================================
const styles = {
  contextMenu: {
    position: 'fixed',
    background: 'rgba(28, 28, 30, 0.98)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: '4px 0',
    minWidth: 160,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    zIndex: 1000,
    fontFamily:
      "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  } as CSSProperties,

  menuItem: (isDestructive = false): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: 'calc(100% - 8px)',
    height: 32,
    margin: '0 4px',
    padding: '0 12px',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    color: isDestructive ? '#ef4444' : '#e4e4e7',
    fontSize: 13,
    fontFamily: 'inherit',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background 0.1s',
  }),

  menuDivider: {
    height: 1,
    background: 'rgba(255,255,255,0.08)',
    margin: '4px 8px',
  } as CSSProperties,

  submenu: {
    position: 'absolute',
    left: '100%',
    top: 0,
    marginLeft: 4,
    background: 'rgba(28, 28, 30, 0.98)',
    backdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: '4px 0',
    minWidth: 160,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  } as CSSProperties,
};

// ============================================
// MenuItem Component
// ============================================
interface MenuItemProps {
  onClick?: () => void;
  icon: React.ReactNode;
  label: string;
  destructive?: boolean;
  hasSubmenu?: boolean;
}

function MenuItem({
  onClick,
  icon,
  label,
  destructive = false,
  hasSubmenu = false,
}: MenuItemProps) {
  return (
    <button
      style={styles.menuItem(destructive)}
      onClick={onClick}
      onMouseEnter={e => {
        e.currentTarget.style.background = destructive
          ? 'rgba(239,68,68,0.10)'
          : 'rgba(255,255,255,0.08)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: destructive ? 0.85 : 0.7,
          color: destructive ? '#ef4444' : '#e4e4e7',
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{label}</span>
      {hasSubmenu && (
        <svg
          width='14'
          height='14'
          viewBox='0 0 24 24'
          fill='none'
          style={{ opacity: 0.5 }}
        >
          <polyline
            points='9 18 15 12 9 6'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
      )}
    </button>
  );
}

// ============================================
// ContextMenu Component
// ============================================
export function ContextMenu({ state, onClose, onAction }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showTurnInto, setShowTurnInto] = useState(false);
  const showTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const typeInfo = getTypeInfo(state.value);
  const isExpandable = state.value !== null && typeof state.value === 'object';

  // 动态位置（用于滚动时更新）
  const [position, setPosition] = useState({ x: state.x, y: state.y });

  // 滚动监听 - 实时更新菜单位置
  useLayoutEffect(() => {
    if (!state.visible) return;

    // 如果有 anchor element，监听滚动并更新位置
    if (state.anchorElement) {
      const updatePosition = () => {
        if (!state.anchorElement) return;
        const rect = state.anchorElement.getBoundingClientRect();
        setPosition({
          x: rect.left + (state.offsetX ?? 0),
          y: rect.top + (state.offsetY ?? 0),
        });
      };

      // 初始位置
      updatePosition();

      const handleScroll = () => {
        requestAnimationFrame(updatePosition);
      };

      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('resize', handleScroll);

      return () => {
        window.removeEventListener('scroll', handleScroll, true);
        window.removeEventListener('resize', handleScroll);
      };
    } else {
      // 没有 anchor element，使用传入的静态位置
      setPosition({ x: state.x, y: state.y });
    }
  }, [
    state.visible,
    state.anchorElement,
    state.x,
    state.y,
    state.offsetX,
    state.offsetY,
  ]);

  // 延迟显示/隐藏子菜单
  const handleTurnIntoHover = useCallback((show: boolean) => {
    if (show) {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      showTimerRef.current = setTimeout(() => {
        setShowTurnInto(true);
      }, 150);
    } else {
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      hideTimerRef.current = setTimeout(() => {
        setShowTurnInto(false);
      }, 100);
    }
  }, []);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  if (!state.visible) return null;

  const TurnIntoSubmenu = () => (
    <div
      style={styles.submenu}
      onMouseEnter={() => handleTurnIntoHover(true)}
      onMouseLeave={() => handleTurnIntoHover(false)}
    >
      {typeInfo.type !== 'object' && (
        <MenuItem
          onClick={() => onAction('convert', 'object')}
          icon='{ }'
          label='Object'
        />
      )}
      {typeInfo.type !== 'array' && (
        <MenuItem
          onClick={() => onAction('convert', 'array')}
          icon='[ ]'
          label='Array'
        />
      )}
      {typeInfo.type !== 'string' && (
        <MenuItem
          onClick={() => onAction('convert', 'string')}
          icon={`""`}
          label='String'
        />
      )}
      {typeInfo.type !== 'number' && (
        <MenuItem
          onClick={() => onAction('convert', 'number')}
          icon='123'
          label='Number'
        />
      )}
      {typeInfo.type !== 'boolean' && (
        <MenuItem
          onClick={() => onAction('convert', 'boolean')}
          icon='T/F'
          label='Boolean'
        />
      )}
      {typeInfo.type !== 'null' && (
        <MenuItem
          onClick={() => onAction('convert', 'null')}
          icon='∅'
          label='Null'
        />
      )}
    </div>
  );

  return (
    <div
      ref={menuRef}
      style={{
        ...styles.contextMenu,
        left: position.x,
        top: position.y,
        transform: state.align === 'right' ? 'translateX(-100%)' : 'none',
      }}
    >
      {/* 添加新元素 */}
      {isExpandable && (
        <>
          <MenuItem
            onClick={() => onAction('add-child')}
            icon={
              <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
                <path
                  d='M7 3v8M3 7h8'
                  stroke='currentColor'
                  strokeWidth='1.3'
                  strokeLinecap='round'
                />
              </svg>
            }
            label={Array.isArray(state.value) ? 'Add Item' : 'Add Property'}
          />
          <div style={styles.menuDivider} />
        </>
      )}

      {/* Copy 操作 */}
      <MenuItem
        onClick={() => onAction('copy-value')}
        icon={
          <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
            <path
              d='M4 4H2.5A1.5 1.5 0 001 5.5v6A1.5 1.5 0 002.5 13h6a1.5 1.5 0 001.5-1.5V10'
              stroke='currentColor'
              strokeWidth='1.2'
              strokeLinecap='round'
            />
            <rect
              x='5'
              y='1'
              width='8'
              height='8'
              rx='1.5'
              stroke='currentColor'
              strokeWidth='1.2'
            />
          </svg>
        }
        label='Copy value'
      />

      <MenuItem
        onClick={() => onAction('copy-path')}
        icon={
          <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
            <path
              d='M7 1v12M1 4l6-3M1 4l6 3M13 4l-6-3M13 4l-6 3M1 10l6-3M1 10l6 3M13 10l-6-3M13 10l-6 3'
              stroke='currentColor'
              strokeWidth='1.2'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          </svg>
        }
        label='Copy path'
      />

      <div style={styles.menuDivider} />

      {/* 编辑操作 */}
      <MenuItem
        onClick={() => onAction('duplicate')}
        icon={
          <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
            <rect
              x='4'
              y='4'
              width='8'
              height='8'
              rx='1.5'
              stroke='currentColor'
              strokeWidth='1.2'
            />
            <path
              d='M10 4V2.5A1.5 1.5 0 008.5 1H2.5A1.5 1.5 0 001 2.5v6A1.5 1.5 0 002.5 10H4'
              stroke='currentColor'
              strokeWidth='1.2'
            />
          </svg>
        }
        label='Duplicate'
      />

      <div style={styles.menuDivider} />

      {/* Turn into 带子菜单 */}
      <div
        style={{ position: 'relative' }}
        onMouseEnter={() => handleTurnIntoHover(true)}
        onMouseLeave={() => handleTurnIntoHover(false)}
      >
        <MenuItem
          icon={
            <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
              <path
                d='M2.5 7a4.5 4.5 0 018.1-2.7'
                stroke='currentColor'
                strokeWidth='1.3'
                strokeLinecap='round'
              />
              <path
                d='M11 2v2.5H8.5'
                stroke='currentColor'
                strokeWidth='1.3'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
              <path
                d='M11.5 7a4.5 4.5 0 01-8.1 2.7'
                stroke='currentColor'
                strokeWidth='1.3'
                strokeLinecap='round'
              />
              <path
                d='M3 12V9.5h2.5'
                stroke='currentColor'
                strokeWidth='1.3'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
            </svg>
          }
          label='Turn into'
          hasSubmenu
        />
        {showTurnInto && <TurnIntoSubmenu />}
      </div>

      <div style={styles.menuDivider} />

      <MenuItem
        onClick={() => onAction('clear-value')}
        icon={
          <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
            <path
              d='M7 7m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0'
              stroke='currentColor'
              strokeWidth='1.2'
            />
            <path
              d='M4 7l6 0'
              stroke='currentColor'
              strokeWidth='1.2'
              strokeLinecap='round'
            />
          </svg>
        }
        label='Clear Value'
        destructive
      />

      <div style={styles.menuDivider} />

      <MenuItem
        onClick={() => onAction('delete')}
        icon={
          <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
            <path
              d='M2 4h10M5 4V2.5A.5.5 0 015.5 2h3a.5.5 0 01.5.5V4M11 4v7.5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 013 11.5V4'
              stroke='currentColor'
              strokeWidth='1.2'
              strokeLinecap='round'
            />
            <path
              d='M5.5 7v4M8.5 7v4'
              stroke='currentColor'
              strokeWidth='1.2'
              strokeLinecap='round'
            />
          </svg>
        }
        label='Delete Node'
        destructive
      />

      {/* HIDDEN: Create Tool menu item temporarily disabled */}
    </div>
  );
}

export default ContextMenu;
