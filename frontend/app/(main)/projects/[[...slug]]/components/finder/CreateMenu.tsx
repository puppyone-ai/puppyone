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
  // Quick SaaS import shortcuts
  onImportNotion?: () => void;
  onImportGitHub?: () => void;
  onImportGmail?: () => void;
  onImportDrive?: () => void;
  onImportCalendar?: () => void;
  onImportSheets?: () => void;
  onImportAirtable?: () => void;
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

// SaaS brand icons
const NotionIcon = () => (
  <svg width="14" height="14" viewBox="0 0 100 100" fill="none">
    <path d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z" fill="#fff"/>
    <path fillRule="evenodd" clipRule="evenodd" d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L74.167 3.143c-4.273 -3.107 -6.02 -3.5 -12.817 -2.917zM25.92 19.523c-5.247 0.353 -6.437 0.433 -9.417 -1.99L8.927 11.507c-0.77 -0.78 -0.383 -1.753 1.557 -1.947l53.193 -3.887c4.467 -0.39 6.793 1.167 8.54 2.527l9.123 6.61c0.39 0.197 1.36 1.36 0.193 1.36l-54.933 3.307 -0.68 0.047zM19.803 88.3V30.367c0 -2.53 0.777 -3.697 3.103 -3.893L86 22.78c2.14 -0.193 3.107 1.167 3.107 3.693v57.547c0 2.53 -0.39 4.67 -3.883 4.863l-60.377 3.5c-3.493 0.193 -5.043 -0.97 -5.043 -4.083zm59.6 -54.827c0.387 1.75 0 3.5 -1.75 3.7l-2.91 0.577v42.773c-2.527 1.36 -4.853 2.137 -6.797 2.137 -3.107 0 -3.883 -0.973 -6.21 -3.887l-19.03 -29.94v28.967l6.02 1.363s0 3.5 -4.857 3.5l-13.39 0.777c-0.39 -0.78 0 -2.723 1.357 -3.11l3.497 -0.97v-38.3L30.48 40.667c-0.39 -1.75 0.58 -4.277 3.3 -4.473l14.367 -0.967 19.8 30.327v-26.83l-5.047 -0.58c-0.39 -2.143 1.163 -3.7 3.103 -3.89l13.4 -0.78z" fill="#000"/>
  </svg>
);

const GitHubIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill={iconColor}>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
  </svg>
);

const GmailIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73l-6.545 4.909-6.545-4.909v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.909 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" fill="#EA4335"/>
  </svg>
);

const DriveIcon = () => (
  <svg width="14" height="14" viewBox="0 0 87.3 78" fill="none">
    <path d="M6.6 66.85L3.85 61.35L29.95 17.2L32.7 22.7L6.6 66.85Z" fill="#0066DA"/>
    <path d="M58.05 66.85H53.25L27.15 22.7H31.95L58.05 66.85Z" fill="#00AC47"/>
    <path d="M83.45 66.85L80.7 61.35L54.6 17.2H59.4L85.5 61.35L83.45 66.85Z" fill="#EA4335"/>
    <path d="M87.3 66.85H0L13.05 78H74.25L87.3 66.85Z" fill="#00832D"/>
    <path d="M43.65 0L13.05 52.7L0 66.85L29.95 17.2H58.05L43.65 0Z" fill="#2684FC"/>
    <path d="M87.3 66.85L74.25 52.7L43.65 0L58.05 17.2L87.3 66.85Z" fill="#FFBA00"/>
  </svg>
);

const CalendarIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M18 4H17V3C17 2.45 16.55 2 16 2C15.45 2 15 2.45 15 3V4H9V3C9 2.45 8.55 2 8 2C7.45 2 7 2.45 7 3V4H6C4.9 4 4 4.9 4 6V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V6C20 4.9 19.1 4 18 4ZM18 20H6V9H18V20Z" fill="#4285F4"/>
    <path d="M8 11H10V13H8V11ZM11 11H13V13H11V11ZM14 11H16V13H14V11ZM8 14H10V16H8V14ZM11 14H13V16H11V14ZM14 14H16V16H14V14Z" fill="#4285F4"/>
  </svg>
);

const SheetsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3Z" fill="#0F9D58"/>
    <path d="M7 7H17V9H7V7ZM7 11H17V13H7V11ZM7 15H13V17H7V15Z" fill="white"/>
  </svg>
);

const AirtableIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M11.992 1.5L2.25 5.953v12.094l9.742 4.453 9.758-4.453V5.953L11.992 1.5z" fill="#FCB400"/>
    <path d="M12 12.75L2.25 8.297v9.797L12 22.5V12.75z" fill="#18BFFF"/>
    <path d="M12 12.75l9.75-4.453v9.797L12 22.5V12.75z" fill="#F82B60"/>
    <path d="M12 1.5L2.25 5.953 12 10.406l9.75-4.453L12 1.5z" fill="#FFCC00" fillOpacity="0.5"/>
  </svg>
);

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
  onImportNotion,
  onImportGitHub,
  onImportGmail,
  onImportDrive,
  onImportCalendar,
  onImportSheets,
  onImportAirtable,
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
            <Divider />
            {/* Quick SaaS shortcuts */}
            {onImportNotion && (
              <MenuItem
                icon={<NotionIcon />}
                label="Notion"
                sublabel="Page or Database"
                onClick={() => { onImportNotion(); onClose(); }}
              />
            )}
            {onImportGitHub && (
              <MenuItem
                icon={<GitHubIcon />}
                label="GitHub"
                sublabel="Repository"
                onClick={() => { onImportGitHub(); onClose(); }}
              />
            )}
            {onImportGmail && (
              <MenuItem
                icon={<GmailIcon />}
                label="Gmail"
                sublabel="Emails"
                onClick={() => { onImportGmail(); onClose(); }}
              />
            )}
            {onImportDrive && (
              <MenuItem
                icon={<DriveIcon />}
                label="Google Drive"
                sublabel="Files"
                onClick={() => { onImportDrive(); onClose(); }}
              />
            )}
            {onImportCalendar && (
              <MenuItem
                icon={<CalendarIcon />}
                label="Google Calendar"
                sublabel="Events"
                onClick={() => { onImportCalendar(); onClose(); }}
              />
            )}
            {onImportSheets && (
              <MenuItem
                icon={<SheetsIcon />}
                label="Google Sheets"
                sublabel="Spreadsheet"
                onClick={() => { onImportSheets(); onClose(); }}
              />
            )}
            {onImportAirtable && (
              <MenuItem
                icon={<AirtableIcon />}
                label="Airtable"
                sublabel="Base"
                onClick={() => { onImportAirtable(); onClose(); }}
              />
            )}
            <MenuItem
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke={iconColor} strokeWidth="1.5" />
                  <path d="M12 8v8M8 12h8" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              }
              label="More Sources..."
              sublabel="Linear..."
              onClick={() => { onImportFromSaas(); onClose(); }}
            />
          </Submenu>
        )}
      </div>
    </div>
  );
}
