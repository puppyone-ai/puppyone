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
  // onImportDrive?: () => void; // Google Drive temporarily disabled
  onImportDocs?: () => void;
  onImportCalendar?: () => void;
  onImportSheets?: () => void;
  // onImportAirtable?: () => void; // Airtable temporarily disabled
  // onImportLinear?: () => void; // Linear temporarily disabled
}

interface MenuItemProps {
  icon?: React.ReactNode;
  label: string;
  sublabel?: string;
  onClick?: () => void;
  onMouseEnter?: () => void;
  isActive?: boolean;
}

function MenuItem({ icon, label, sublabel, onClick, onMouseEnter, isActive }: MenuItemProps) {
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
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 8px' }} />;
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
  <img src="/icons/gmail.svg" alt="Gmail" width={14} height={14} style={{ display: 'block' }} />
);

// Google Drive temporarily disabled
// const DriveIcon = () => (
//   <img src="/icons/google_drive.svg" alt="Google Drive" width={14} height={14} style={{ display: 'block' }} />
// );

const DocsIcon = () => (
  <img src="/icons/google_doc.svg" alt="Google Docs" width={14} height={14} style={{ display: 'block' }} />
);

const CalendarIcon = () => (
  <img src="/icons/google_calendar.svg" alt="Google Calendar" width={14} height={14} style={{ display: 'block' }} />
);

const SheetsIcon = () => (
  <img src="/icons/google_sheet.svg" alt="Google Sheets" width={14} height={14} style={{ display: 'block' }} />
);

// Airtable and Linear temporarily disabled - not yet integrated
// const AirtableIcon = () => (
//   <img src="/icons/airtable.png" alt="Airtable" width={14} height={14} style={{ display: 'block', borderRadius: 2 }} />
// );

// const LinearIcon = () => (
//   <img src="/icons/linear.svg" alt="Linear" width={14} height={14} style={{ display: 'block' }} />
// );

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
  // onImportDrive, // Google Drive temporarily disabled
  onImportDocs,
  onImportCalendar,
  onImportSheets,
  // onImportAirtable, // Airtable temporarily disabled
  // onImportLinear, // Linear temporarily disabled
}: CreateMenuProps) {
  const [adjustedPosition, setAdjustedPosition] = useState<{ top: number; left: number }>({ top: y, left: x });
  const menuRef = useRef<HTMLDivElement>(null);

  // Adjust menu position to prevent overflow
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const padding = 12; // Minimum distance from viewport edge
      
      let newTop = y;
      let newLeft = x;
      
      // Check bottom overflow - if menu would go below viewport, position it above the click point
      if (y + rect.height > viewportHeight - padding) {
        // Position menu so its bottom is at the click point (or as close as possible)
        newTop = Math.max(padding, y - rect.height);
      }
      
      // Check right overflow
      if (x + rect.width > viewportWidth - padding) {
        newLeft = Math.max(padding, viewportWidth - rect.width - padding);
      }
      
      // Check left overflow
      if (newLeft < padding) {
        newLeft = padding;
      }
      
      // Check top overflow (in case we moved it up too much)
      if (newTop < padding) {
        newTop = padding;
      }
      
      if (newTop !== adjustedPosition.top || newLeft !== adjustedPosition.left) {
        setAdjustedPosition({ top: newTop, left: newLeft });
      }
    }
  }, [x, y]); // Only run when initial position changes

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        top: adjustedPosition.top,
        left: adjustedPosition.left,
        zIndex: 1000,
        background: 'rgba(28, 28, 30, 0.98)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8,
        padding: '4px 0',
        minWidth: 240,
        maxHeight: 400, // Limit height for scrolling
        overflowY: 'auto', // Enable scrolling
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}
    >
      <div style={{ padding: '6px 16px 2px', fontSize: 11, fontWeight: 600, color: '#71717a', letterSpacing: '0.05em' }}>
        Create
      </div>

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
      />

      <MenuItem
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" />
            <path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        }
        label="Create Blank JSON"
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
        label="Create Blank Markdown"
        onClick={() => { onCreateBlankMarkdown(); onClose(); }}
      />

      <Divider />

      <div style={{ padding: '6px 16px 2px', fontSize: 11, fontWeight: 600, color: '#71717a', letterSpacing: '0.05em' }}>
        Import from
      </div>

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

      {/* Quick SaaS shortcuts */}
      {/* Notion temporarily hidden - still in development */}
      {/* {onImportNotion && (
        <MenuItem
          icon={<NotionIcon />}
          label="Notion"
          sublabel="Page or Database"
          onClick={() => { onImportNotion(); onClose(); }}
        />
      )} */}
      
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
      
      {/* Google Drive temporarily disabled */}
      {/* {onImportDrive && (
        <MenuItem
          icon={<DriveIcon />}
          label="Google Drive"
          sublabel="Files"
          onClick={() => { onImportDrive(); onClose(); }}
        />
      )} */}
      
      {onImportDocs && (
        <MenuItem
          icon={<DocsIcon />}
          label="Google Docs"
          sublabel="Document"
          onClick={() => { onImportDocs(); onClose(); }}
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
    </div>
  );
}
