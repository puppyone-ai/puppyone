'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';

export type CreateType =
  | 'folder'
  | 'blank-json'
  | 'blank-markdown'
  | 'import-files'
  | 'import-url'
  | 'import-saas';

export interface CreateMenuProps {
  x: number;
  y: number;
  anchorLeft?: number;
  onClose: () => void;
  // When `accessOnly` is true, the menu skips the Create Blank /
  // Upload sections entirely and renders the access-provider list
  // (Notion, Gmail, Calendar, …, Machine Folder, Chat Agent, etc.)
  // as the top-level menu — flat, no `New Access >` submenu trigger.
  // This is what the per-folder plug button uses: the user already
  // expressed the intent "create access for this folder" by clicking
  // the plug, so the picker shouldn't make them traverse a nested
  // submenu to *get* to the access list.
  accessOnly?: boolean;
  onCreateFolder: () => void;
  onCreateBlankJson: () => void;
  onCreateBlankMarkdown: () => void;
  onImportFromFiles: () => void;
  onImportFromUrl: () => void;
  onImportFromSaas: () => void;
  onImportNotion?: () => void;
  onImportGitHub?: () => void;
  onImportGmail?: () => void;
  onImportDocs?: () => void;
  onImportCalendar?: () => void;
  onImportSheets?: () => void;
  onConnectSupabase?: () => void;
  onImportSearchConsole?: () => void;
  onImportLocalFolder?: () => void;
  onCreateAgent?: () => void;
  onCreateMcp?: () => void;
  onCreateSandbox?: () => void;
}

interface MenuItemProps {
  icon?: ReactNode;
  label: string;
  sublabel?: string;
  onClick?: (e: ReactMouseEvent) => void;
  onMouseEnter?: (e: ReactMouseEvent<HTMLDivElement>) => void;
  isActive?: boolean;
  hasSubmenu?: boolean;
  disabled?: boolean;
}

function MenuItem({ icon, label, sublabel, onClick, onMouseEnter, isActive, hasSubmenu, disabled }: MenuItemProps) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 32,
        padding: '0 12px',
        cursor: disabled ? 'default' : 'pointer',
        color: disabled ? '#52525b' : '#e4e4e7',
        fontSize: 14,
        transition: 'background 0.1s',
        background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
        borderRadius: 6,
        margin: '0 4px',
        position: 'relative',
        opacity: disabled ? 0.55 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = 'transparent';
      }}
    >
      {icon && (
        <span style={{
          display: 'flex', width: 14, height: 14, alignItems: 'center', justifyContent: 'center',
          opacity: disabled ? 0.4 : 0.7,
          filter: disabled ? 'grayscale(1)' : undefined,
        }}>
          {icon}
        </span>
      )}
      <span style={{ flex: 1, whiteSpace: 'nowrap' }}>{label}</span>
      {sublabel && <span style={{ fontSize: 11, color: disabled ? '#52525b' : '#71717a', marginLeft: 8 }}>{sublabel}</span>}
      {hasSubmenu && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 8px' }} />;
}

const iconColor = '#a1a1aa';

const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z" fill="#60a5fa" fillOpacity="0.45" />
  </svg>
);

const JsonIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M4 4v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6a2 2 0 0 0-2 2z" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 2v6h6" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 12l-2 2 2 2" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 12l2 2-2 2" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MarkdownIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M4 4v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6a2 2 0 0 0-2 2z" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 2v6h6" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 16v-4l2.5 2.5L13 12v4" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16 16v-4h2v4" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16 14h2" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const UploadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const ConnectIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22v-5" />
    <path d="M9 8V2" />
    <path d="M15 8V2" />
    <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
  </svg>
);

const NotionIcon = () => (
  <svg width="14" height="14" viewBox="0 0 100 100" fill="none">
    <path d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z" fill="#fff" />
    <path fillRule="evenodd" clipRule="evenodd" d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L74.167 3.143c-4.273 -3.107 -6.02 -3.5 -12.817 -2.917zM25.92 19.523c-5.247 0.353 -6.437 0.433 -9.417 -1.99L8.927 11.507c-0.77 -0.78 -0.383 -1.753 1.557 -1.947l53.193 -3.887c4.467 -0.39 6.793 1.167 8.54 2.527l9.123 6.61c0.39 0.197 1.36 1.36 0.193 1.36l-54.933 3.307 -0.68 0.047zM19.803 88.3V30.367c0 -2.53 0.777 -3.697 3.103 -3.893L86 22.78c2.14 -0.193 3.107 1.167 3.107 3.693v57.547c0 2.53 -0.39 4.67 -3.883 4.863l-60.377 3.5c-3.493 0.193 -5.043 -0.97 -5.043 -4.083zm59.6 -54.827c0.387 1.75 0 3.5 -1.75 3.7l-2.91 0.577v42.773c-2.527 1.36 -4.853 2.137 -6.797 2.137 -3.107 0 -3.883 -0.973 -6.21 -3.887l-19.03 -29.94v28.967l6.02 1.363s0 3.5 -4.857 3.5l-13.39 0.777c-0.39 -0.78 0 -2.723 1.357 -3.11l3.497 -0.97v-38.3L30.48 40.667c-0.39 -1.75 0.58 -4.277 3.3 -4.473l14.367 -0.967 19.8 30.327v-26.83l-5.047 -0.58c-0.39 -2.143 1.163 -3.7 3.103 -3.89l13.4 -0.78z" fill="#000" />
  </svg>
);

const GitHubIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill={iconColor}>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

const GmailIcon = () => <img src="/icons/gmail.svg" alt="Gmail" width={14} height={14} style={{ display: 'block' }} />;
const DocsIcon = () => <img src="/icons/google_doc.svg" alt="Google Docs" width={14} height={14} style={{ display: 'block' }} />;
const CalendarIcon = () => <img src="/icons/google_calendar.svg" alt="Google Calendar" width={14} height={14} style={{ display: 'block' }} />;
const SheetsIcon = () => <img src="/icons/google_sheet.svg" alt="Google Sheets" width={14} height={14} style={{ display: 'block' }} />;

const SupabaseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 109 113" fill="none">
    <path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill="url(#paint0_linear)" />
    <path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill="url(#paint1_linear)" fillOpacity="0.2" />
    <path d="M45.317 2.07103C48.1765 -1.53037 53.9745 0.442937 54.0434 5.041L54.4849 72.2922H9.83113C1.64038 72.2922 -2.92775 62.8321 2.1655 56.4175L45.317 2.07103Z" fill="#3ECF8E" />
    <defs>
      <linearGradient id="paint0_linear" x1="53.9738" y1="54.974" x2="94.1635" y2="71.8295" gradientUnits="userSpaceOnUse">
        <stop stopColor="#249361" />
        <stop offset="1" stopColor="#3ECF8E" />
      </linearGradient>
      <linearGradient id="paint1_linear" x1="36.1558" y1="30.578" x2="54.4844" y2="65.0806" gradientUnits="userSpaceOnUse">
        <stop />
        <stop offset="1" stopOpacity="0" />
      </linearGradient>
    </defs>
  </svg>
);

const SearchConsoleIcon = () => <span style={{ fontSize: 14 }}>📊</span>;

const LocalFolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M2 20h20" />
  </svg>
);

const ChatAgentIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M6 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4-4v2" />
  </svg>
);

const McpIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

const SandboxIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

export function CreateMenu({
  x,
  y,
  anchorLeft,
  onClose,
  accessOnly,
  onCreateFolder,
  onCreateBlankJson,
  onCreateBlankMarkdown,
  onImportFromFiles,
  onImportFromUrl,
  onImportFromSaas,
  onImportNotion,
  onImportGitHub,
  onImportGmail,
  onImportDocs,
  onImportCalendar,
  onImportSheets,
  onConnectSupabase,
  onImportSearchConsole,
  onImportLocalFolder,
  onCreateAgent,
  onCreateMcp,
  onCreateSandbox,
}: CreateMenuProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [activeSubMenu, setActiveSubMenu] = useState<'upload' | 'connect' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;

    const menuWidth = element.scrollWidth;
    const menuHeight = element.scrollHeight;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const pad = 12;
    let left = anchorLeft ?? x;
    if (left + menuWidth > viewportWidth - pad) {
      left = Math.max(pad, viewportWidth - menuWidth - pad);
    }

    let top = y;
    if (top + menuHeight > viewportHeight - pad) {
      top = Math.max(pad, viewportHeight - menuHeight - pad);
    }

    setPosition({ top, left });
  }, [x, y, anchorLeft]);

  return (
    <div
      ref={menuRef}
      onMouseLeave={() => setActiveSubMenu(null)}
      style={{
        position: 'fixed',
        top: position?.top ?? y,
        left: position?.left ?? x,
        zIndex: 1000,
        background: 'rgba(28, 28, 30, 0.98)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8,
        padding: '4px 0',
        minWidth: 240,
        maxHeight: 'calc(100vh - 24px)',
        overflow: 'visible',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {!accessOnly && (
        <>
          <div style={{ padding: '6px 16px 2px', fontSize: 11, fontWeight: 600, color: '#71717a', letterSpacing: '0.05em' }}>
            Create Blank
          </div>

          <MenuItem icon={<FolderIcon />} label="Folder" onClick={() => { onCreateFolder(); onClose(); }} onMouseEnter={() => setActiveSubMenu(null)} />
          <MenuItem icon={<MarkdownIcon />} label="Markdown" onClick={() => { onCreateBlankMarkdown(); onClose(); }} onMouseEnter={() => setActiveSubMenu(null)} />
          <MenuItem icon={<JsonIcon />} label="JSON" onClick={() => { onCreateBlankJson(); onClose(); }} onMouseEnter={() => setActiveSubMenu(null)} />

          <Divider />

          <div style={{ position: 'relative' }}>
            <MenuItem
              icon={<UploadIcon />}
              label="Upload"
              hasSubmenu
              isActive={activeSubMenu === 'upload'}
              onMouseEnter={() => setActiveSubMenu('upload')}
            />
            {activeSubMenu === 'upload' && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: '100%',
                  marginLeft: 4,
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
              </div>
            )}
          </div>
        </>
      )}

      <div style={{ position: 'relative' }}>
        {/* In accessOnly mode the access list IS the menu, so we
            skip the "New Access >" parent row and render the
            access content flat at the menu's top level.  The
            wrapper still exists because we share the same content
            block between flat and submenu modes. */}
        {!accessOnly && (
          <MenuItem
            icon={<ConnectIcon />}
            label="New Integration"
            hasSubmenu
            isActive={activeSubMenu === 'connect'}
            onMouseEnter={() => setActiveSubMenu('connect')}
          />
        )}
        {(accessOnly || activeSubMenu === 'connect') && (
          <div
            style={accessOnly ? {
              padding: '4px 0',
              minWidth: 240,
            } : {
              position: 'absolute',
              top: 0,
              left: '100%',
              marginLeft: 4,
              background: 'rgba(28, 28, 30, 0.98)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              padding: '4px 0',
              minWidth: 240,
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              zIndex: 1001,
              maxHeight: 'calc(100vh - 40px)',
              overflowY: 'auto',
            }}
          >
            <div style={{ padding: '6px 16px 2px', fontSize: 10, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Sync data from a source
            </div>
            {onImportNotion && <MenuItem icon={<NotionIcon />} label="Notion" sublabel="Pages" onClick={() => { onImportNotion(); onClose(); }} />}
            {onImportGmail && <MenuItem icon={<GmailIcon />} label="Gmail" sublabel="Emails" onClick={() => { onImportGmail(); onClose(); }} />}
            {onImportCalendar && <MenuItem icon={<CalendarIcon />} label="Google Calendar" sublabel="Events" onClick={() => { onImportCalendar(); onClose(); }} />}
            {onImportDocs && <MenuItem icon={<DocsIcon />} label="Google Docs" sublabel="Document" onClick={() => { onImportDocs(); onClose(); }} />}
            {onImportSheets && <MenuItem icon={<SheetsIcon />} label="Google Sheets" sublabel="Spreadsheet" onClick={() => { onImportSheets(); onClose(); }} />}
            {onConnectSupabase && <MenuItem icon={<SupabaseIcon />} label="Supabase" sublabel="Database" onClick={() => { onConnectSupabase(); onClose(); }} />}
            <MenuItem
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke={iconColor} strokeWidth="1.5" />
                  <path d="M2 12h20" stroke={iconColor} strokeWidth="1.5" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke={iconColor} strokeWidth="1.5" />
                </svg>
              }
              label="Web Page"
              sublabel="URL"
              onClick={() => { onImportFromUrl(); onClose(); }}
            />
            <MenuItem icon={<GitHubIcon />} label="GitHub" sublabel="Coming soon" disabled />
            <MenuItem icon={<SearchConsoleIcon />} label="Google Search Console" sublabel="Coming soon" disabled />

            <Divider />

            <div style={{ padding: '6px 16px 2px', fontSize: 10, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Sync data with a folder
            </div>
            {onImportLocalFolder && <MenuItem icon={<LocalFolderIcon />} label="Machine Folder" sublabel="Two-way sync via terminal" onClick={() => { onImportLocalFolder(); onClose(); }} />}

            <Divider />

            <div style={{ padding: '6px 16px 2px', fontSize: 10, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Connect via terminal
            </div>
            <MenuItem
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>}
              label="SSH Terminal"
              sublabel="Coming soon"
              disabled
            />

            <Divider />

            <div style={{ padding: '6px 16px 2px', fontSize: 10, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Share data with an AI Agent
            </div>
            <MenuItem icon={<ChatAgentIcon />} label="Chat Agent" onClick={() => { onCreateAgent?.(); onClose(); }} />

            <Divider />

            <div style={{ padding: '6px 16px 2px', fontSize: 10, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Expose data
            </div>
            <MenuItem icon={<McpIcon />} label="MCP Server" sublabel="Coming soon" disabled />
            <MenuItem icon={<SandboxIcon />} label="Sandbox" sublabel="Coming soon" disabled />

            {/* "More Sources…" is the open-the-empty-picker fallback
                — useful from `+ → New Access` when the user is
                exploring, but pointless from the per-folder plug
                button (the user has already declared intent by
                clicking the plug, an empty picker is a step
                backwards).  Hide it in accessOnly mode. */}
            {!accessOnly && (
              <>
                <Divider />

                <MenuItem
                  icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={iconColor} strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>}
                  label="More Sources..."
                  onClick={() => { onImportFromSaas(); onClose(); }}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
