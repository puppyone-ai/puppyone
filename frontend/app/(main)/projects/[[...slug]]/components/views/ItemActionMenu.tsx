'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

// === Icons ===

const MoreIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="6" r="1.5" fill="currentColor" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    <circle cx="12" cy="18" r="1.5" fill="currentColor" />
  </svg>
);

const RenameIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M11 4H4C2.89543 4 2 4.89543 2 6V20C2 21.1046 2.89543 22 4 22H18C19.1046 22 20 21.1046 20 20V13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M18.5 2.5C19.3284 1.67157 20.6716 1.67157 21.5 2.5C22.3284 3.32843 22.3284 4.67157 21.5 5.5L12 15L8 16L9 12L18.5 2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DeleteIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M3 6H5H21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 6V4C8 3.44772 8.44772 3 9 3H15C15.5523 3 16 3.44772 16 4V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M19 6V20C19 21.1046 18.1046 22 17 22H7C5.89543 22 5 21.1046 5 20V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 11V17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M14 11V17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const DuplicateIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C15.3019 3 18.1885 4.77814 19.7545 7.42909" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M21 3V8H16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M10 13C10.4295 13.5741 10.9774 14.0491 11.6066 14.3929C12.2357 14.7367 12.9315 14.9411 13.6467 14.9923C14.3618 15.0435 15.0796 14.9403 15.7513 14.6897C16.4231 14.4392 17.0331 14.047 17.54 13.54L20.54 10.54C21.4508 9.59695 21.9548 8.33394 21.9434 7.02296C21.932 5.71198 21.4061 4.45791 20.4791 3.53087C19.5521 2.60383 18.298 2.07799 16.987 2.0666C15.676 2.0552 14.413 2.55918 13.47 3.47L11.75 5.18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M14 11C13.5705 10.4259 13.0226 9.9509 12.3934 9.60707C11.7642 9.26324 11.0685 9.05886 10.3533 9.00768C9.63816 8.95651 8.92037 9.05966 8.24861 9.31026C7.57685 9.56085 6.96684 9.95305 6.46 10.46L3.46 13.46C2.54918 14.403 2.0452 15.6661 2.0566 16.977C2.068 18.288 2.59383 19.5421 3.52087 20.4691C4.44791 21.3962 5.70198 21.922 7.01296 21.9334C8.32394 21.9448 9.58695 21.4408 10.53 20.53L12.24 18.82" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// === Types ===

export interface ItemActionMenuProps {
  itemId: string;
  itemName: string;
  itemType: string;
  onRename?: (id: string, currentName: string) => void;
  onDelete?: (id: string, name: string) => void;
  onDuplicate?: (id: string) => void;
  /** 刷新同步数据（仅 synced 类型显示） */
  onRefresh?: (id: string) => void;
  /** 同步来源 URL（仅 synced 类型显示） */
  syncUrl?: string | null;
  /** 是否显示按钮（hover 时才显示） */
  visible?: boolean;
  /** 菜单方向 */
  position?: 'bottom-left' | 'bottom-right';
  /** 小尺寸模式（用于列表/列视图） */
  compact?: boolean;
}

interface MenuItem {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

// === Menu Component ===

export function ItemActionMenu({
  itemId,
  itemName,
  itemType,
  onRename,
  onDelete,
  onDuplicate,
  onRefresh,
  syncUrl,
  visible = true,
  position = 'bottom-left',
  compact = false,
}: ItemActionMenuProps) {
  // Use menuPosition as the source of truth for open state
  // null = closed, object = open with position
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  
  const isOpen = menuPosition !== null;

  // Calculate menu position synchronously when opening
  const calculatePosition = () => {
    if (!buttonRef.current) return null;
    
    const rect = buttonRef.current.getBoundingClientRect();
    const menuWidth = 140;
    
    // Calculate position based on alignment preference
    let left: number;
    if (position === 'bottom-right') {
      // Menu aligns to the right of the button (extends leftward)
      left = rect.right - menuWidth;
    } else {
      // Menu aligns to the left of the button (extends rightward)
      left = rect.left;
    }
    
    // Keep menu within viewport
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }
    if (left < 8) {
      left = 8;
    }
    
    return {
      top: rect.bottom + 4,
      left,
    };
  };

  const handleOpen = () => {
    const pos = calculatePosition();
    if (pos) {
      setMenuPosition(pos);
    }
  };

  const handleClose = () => {
    setMenuPosition(null);
  };

  // Close menu when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    };

    // Close on escape
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    // Close on scroll
    const handleScroll = () => {
      handleClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen]);

  // Build menu items
  const menuItems: MenuItem[] = [];

  // Sync-specific actions (Refresh, Open URL)
  if (onRefresh) {
    menuItems.push({
      icon: <RefreshIcon />,
      label: 'Refresh',
      onClick: () => {
        handleClose();
        onRefresh(itemId);
      },
    });
  }

  if (syncUrl) {
    menuItems.push({
      icon: <LinkIcon />,
      label: 'Open Source',
      onClick: () => {
        handleClose();
        window.open(syncUrl, '_blank');
      },
    });
  }

  if (onRename) {
    menuItems.push({
      icon: <RenameIcon />,
      label: 'Rename',
      onClick: () => {
        handleClose();
        onRename(itemId, itemName);
      },
    });
  }

  if (onDuplicate) {
    menuItems.push({
      icon: <DuplicateIcon />,
      label: 'Duplicate',
      onClick: () => {
        handleClose();
        onDuplicate(itemId);
      },
    });
  }

  if (onDelete) {
    menuItems.push({
      icon: <DeleteIcon />,
      label: 'Delete',
      danger: true,
      onClick: () => {
        handleClose();
        onDelete(itemId, itemName);
      },
    });
  }

  // Don't render if no actions available
  if (menuItems.length === 0) return null;

  const buttonSize = compact ? 20 : 24;

  return (
    <div
      style={{
        position: 'relative',
        opacity: visible || isOpen ? 1 : 0,
        transition: 'opacity 0.15s',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Trigger Button */}
      <div
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (isOpen) {
            handleClose();
          } else {
            handleOpen();
          }
        }}
        style={{
          width: buttonSize,
          height: buttonSize,
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: isOpen ? '#fff' : '#71717a',
          background: isOpen ? 'rgba(255,255,255,0.1)' : 'transparent',
          transition: 'all 0.1s',
        }}
        onMouseEnter={(e) => {
          if (!isOpen) {
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
            e.currentTarget.style.color = '#a1a1aa';
          }
        }}
        onMouseLeave={(e) => {
          if (!isOpen) {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = '#71717a';
          }
        }}
      >
        <MoreIcon />
      </div>

      {/* Dropdown Menu - rendered via Portal to avoid overflow clipping */}
      {menuPosition && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: menuPosition.top,
            left: menuPosition.left,
            minWidth: 140,
            background: '#1f1f23',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            padding: '4px 0',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 10000,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {menuItems.map((item, index) => (
            <div
              key={index}
              onClick={(e) => {
                e.stopPropagation();
                item.onClick();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                cursor: 'pointer',
                color: item.danger ? '#f87171' : '#d4d4d8',
                fontSize: 13,
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = item.danger
                  ? 'rgba(248, 113, 113, 0.1)'
                  : 'rgba(255,255,255,0.06)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {item.icon}
              </div>
              <span>{item.label}</span>
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

