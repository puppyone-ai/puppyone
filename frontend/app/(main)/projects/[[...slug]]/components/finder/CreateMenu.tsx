'use client';

import { useState, useRef, useEffect } from 'react';

export type CreateType = 'folder' | 'blank-json' | 'blank-markdown' | 'import-files' | 'import-url' | 'import-saas';

export interface CreateMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onCreateFolder: () => void;
  onCreateBlankJson: () => void;
  onCreateBlankMarkdown: () => void;
  onImportFromFiles: () => void;
  onImportFromUrl: () => void;
  onImportFromSaas: () => void;
}

interface MenuItemProps {
  icon?: React.ReactNode;
  label: string;
  sublabel?: string;
  onClick?: () => void;
  hasSubmenu?: boolean;
  onMouseEnter?: () => void;
  isActive?: boolean;
}

function MenuItem({ icon, label, sublabel, onClick, hasSubmenu, onMouseEnter, isActive }: MenuItemProps) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 32,
        padding: '0 12px',
        cursor: 'pointer',
        color: '#e4e4e7',
        fontSize: 14,
        transition: 'background 0.1s',
        background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
        borderRadius: 6,
        margin: '0 4px',
        position: 'relative', // For submenu positioning context if needed
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
        onMouseEnter?.();
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = 'transparent';
      }}
    >
      <span style={{ display: 'flex', width: 14, height: 14, alignItems: 'center', justifyContent: 'center', opacity: 0.7 }}>
        {icon}
      </span>
      <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{label}</span>
      {sublabel && (
        <span style={{ fontSize: 11, color: '#71717a', marginLeft: 8 }}>{sublabel}</span>
      )}
      {hasSubmenu && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginLeft: 'auto', opacity: 0.5 }}>
          <path d="M9 18l6-6-6-6" />
        </svg>
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 8px' }} />;
}

// Submenu component to handle positioning
function Submenu({ 
  children, 
  parentRect 
}: { 
  children: React.ReactNode; 
  parentRect: DOMRect | null 
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left?: string | number; right?: string | number; top: number }>({ left: '100%', top: -4 });

  useEffect(() => {
    if (ref.current && parentRect) {
      const rect = ref.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      
      // Check if submenu overflows the right edge
      // parentRect.right is the right edge of the parent menu
      // We want to place submenu at parentRect.right + 8
      const spaceRight = viewportWidth - parentRect.right;
      const spaceLeft = parentRect.left;
      
      // If not enough space on right (< 200px) and more space on left, flip to left
      if (spaceRight < 220 && spaceLeft > spaceRight) {
         setPosition({ right: '100%', top: -4 });
      } else {
         setPosition({ left: '100%', top: -4 });
      }
    }
  }, [parentRect]);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        ...position,
        marginLeft: position.left ? 8 : 0,
        marginRight: position.right ? 8 : 0,
        background: 'rgba(28, 28, 30, 0.98)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8,
        padding: '4px 0',
        minWidth: 180,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        zIndex: 1001,
      }}
    >
      {/* Invisible bridge to prevent mouseleave when crossing gap */}
      <div 
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: 20,
          [position.left ? 'right' : 'left']: '100%',
          background: 'transparent',
        }} 
      />
      {children}
    </div>
  );
}

// Unified icon color
const iconColor = '#a1a1aa';

export function CreateMenu({
  x,
  y,
  onClose,
  onCreateFolder,
  onCreateBlankJson,
  onCreateBlankMarkdown,
  onImportFromFiles,
  onImportFromUrl,
  onImportFromSaas,
}: CreateMenuProps) {
  const [activeSubmenu, setActiveSubmenu] = useState<'context' | 'import' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnterItem = (submenu: 'context' | 'import' | null) => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setActiveSubmenu(submenu);
  };

  const handleMouseLeaveMenu = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setActiveSubmenu(null);
    }, 150); // Small delay to allow crossing the gap
  };

  const handleMouseEnterMenu = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const getParentRect = () => menuRef.current?.getBoundingClientRect() ?? null;

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 1000,
        background: 'rgba(28, 28, 30, 0.98)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8,
        padding: '4px 0',
        minWidth: 180,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}
      onMouseLeave={handleMouseLeaveMenu}
      onMouseEnter={handleMouseEnterMenu}
    >
      {/* Create Folder */}
      <MenuItem
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z"
              fill={iconColor}
              fillOpacity="0.15"
              stroke={iconColor}
              strokeWidth="1.5"
            />
          </svg>
        }
        label="Create Folder"
        onClick={() => { onCreateFolder(); onClose(); }}
        onMouseEnter={() => handleMouseEnterItem(null)}
      />

      {/* Create Context */}
      <div style={{ position: 'relative' }}>
        <MenuItem
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="2" stroke={iconColor} strokeWidth="1.5" />
              <path d="M12 8v8M8 12h8" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          }
          label="Create Context"
          hasSubmenu
          isActive={activeSubmenu === 'context'}
          onMouseEnter={() => handleMouseEnterItem('context')}
        />
        {activeSubmenu === 'context' && (
          <Submenu parentRect={getParentRect()}>
            <MenuItem
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              }
              label="JSON"
              onClick={() => { onCreateBlankJson(); onClose(); }}
            />
            <MenuItem
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="18" height="18" rx="2" stroke={iconColor} strokeWidth="1.5" />
                  <path d="M7 15V9l2.5 3 2.5-3v6" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M17 12l-2 3h4l-2-3v-3" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              }
              label="Markdown"
              onClick={() => { onCreateBlankMarkdown(); onClose(); }}
            />
          </Submenu>
        )}
      </div>

      <Divider />

      {/* Import */}
      <div style={{ position: 'relative' }}>
        <MenuItem
          icon={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 3v12" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" />
              <path d="M8 11l4 4 4-4" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M19 17v4H5v-4" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          }
          label="Import"
          hasSubmenu
          isActive={activeSubmenu === 'import'}
          onMouseEnter={() => handleMouseEnterItem('import')}
        />
        {activeSubmenu === 'import' && (
          <Submenu parentRect={getParentRect()}>
            <MenuItem
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke={iconColor} strokeWidth="1.5" />
                  <polyline points="14,2 14,8 20,8" stroke={iconColor} strokeWidth="1.5" />
                </svg>
              }
              label="Files"
              sublabel="PDF, MD, CSV"
              onClick={() => { onImportFromFiles(); onClose(); }}
            />
            <MenuItem
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke={iconColor} strokeWidth="1.5" />
                  <path d="M2 12h20" stroke={iconColor} strokeWidth="1.5" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke={iconColor} strokeWidth="1.5" />
                </svg>
              }
              label="URL"
              sublabel="Web page"
              onClick={() => { onImportFromUrl(); onClose(); }}
            />
            <MenuItem
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              }
              label="SaaS"
              sublabel="Notion, GitHub, Sheets..."
              onClick={() => { onImportFromSaas(); onClose(); }}
            />
          </Submenu>
        )}
      </div>
    </div>
  );
}
