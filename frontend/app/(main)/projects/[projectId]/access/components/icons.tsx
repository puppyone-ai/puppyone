/**
 * Icons used across the access page.
 *
 * Two flavours coexist:
 *  - Provider logos (Gmail / Sheets / GitHub / Notion image URLs +
 *    inline SVG fallbacks for cli / agent / mcp / sandbox / generic).
 *  - Action / chrome glyphs (Pause / Play / Retry / Edit / More /
 *    Folder / File / Copy / Chevron) — used by buttons, badges,
 *    tree-preview rows.
 *
 * Kept in one file because they're all small SVGs that share the
 * same currentColor pattern; splitting per-icon would add 12 files
 * for ~10 lines each.
 */

import { T } from '../lib/tokens';

export function ProviderIcon({ provider, size = 16 }: { readonly provider: string; readonly size?: number }) {
  const logos: Record<string, string> = {
    gmail: 'https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_32dp.png',
    google_sheets: 'https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png',
    google_calendar: 'https://www.gstatic.com/images/branding/product/1x/calendar_2020q4_32dp.png',
    google_docs: 'https://www.gstatic.com/images/branding/product/1x/docs_2020q4_32dp.png',
    github: 'https://github.githubassets.com/favicons/favicon-dark.svg',
    notion: 'https://www.notion.so/images/favicon.ico',
  };
  if (logos[provider]) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logos[provider]} alt={provider} width={size} height={size} style={{ display: 'block', borderRadius: 2 }} />;
  }
  if (provider === 'cli') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--po-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    );
  }
  if (provider === 'filesystem') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--po-info)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6.5a2 2 0 0 1 2-2h4.59a2 2 0 0 1 1.41.59l1 1a2 2 0 0 0 1.41.58H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5z" />
        <path d="M9 16v-5" />
        <polyline points="7 13 9 11 11 13" />
        <path d="M15 11v5" />
        <polyline points="13 14 15 16 17 14" />
      </svg>
    );
  }
  if (provider === 'agent') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--po-file-accent-audio)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v6m0 10v6m11-11h-6m-10 0H1m17.07-7.07l-4.24 4.24m-5.66 5.66l-4.24 4.24m12.73 0l-4.24-4.24m-5.66-5.66L1.93 4.93" />
      </svg>
    );
  }
  if (provider === 'mcp') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--po-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    );
  }
  if (provider === 'sandbox') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--po-warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 9l2 2-2 2M13 15h2" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--po-text-subtle)" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export const PauseIcon = ({ size = 11 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
);
export const PlayIcon = ({ size = 11 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
);
export const RetryIcon = ({ size = 11 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);
export const EditIcon = ({ size = 10 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4z" /></svg>
);
export const ChevronRightIcon = ({ size = 10 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);
export const MoreVerticalIcon = ({ size = 12 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
);
export const FolderGlyph = ({ size = 11, color = T.text2 }: { readonly size?: number; readonly color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

// The same shape ExplorerSidebar uses for an open folder row. We share
// the glyph (not the component, to avoid a cross-page import) so the
// scope card visibly says "this AP is mounted under that node in your
// data tree" — instead of using a generic stroke icon that has nothing
// to do with the sidebar's vocabulary. ONLY used for the right-pane
// mount-point card; the sidebar uses `ScopePinGlyph` instead — see
// the note there.
export const ScopeFolderGlyph = ({ size = 16 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M4 20H20C21.1046 20 22 19.1046 22 18V8C22 6.89543 21.1046 6 20 6H13.8284C13.298 6 12.7893 5.78929 12.4142 5.41421L10.5858 3.58579C10.2107 3.21071 9.70201 3 9.17157 3H4C2.89543 3 2 3.89543 2 5V18C2 19.1046 2.89543 20 4 20Z"
      fill="var(--po-accent)"
      fillOpacity="0.25"
    />
    <path
      d="M 9.5 10 L 23 10 Q 24 10 23.5 11 L 19.5 19 Q 19 20 18 20 L 4.5 20 Q 3.5 20 4 19 L 8 11 Q 8.5 10 9.5 10 Z"
      fill="var(--po-accent)"
      fillOpacity="0.55"
    />
  </svg>
);

/**
 * Sidebar-only glyph for an access-point row.
 *
 * Reusing the data view's filled-blue folder here would have read as
 * "this is a folder" — but the *access page* sidebar is a list of
 * mount endpoints, not a file tree. To keep the surfaces visually
 * distinct (folder = data view's primary subject; access endpoint =
 * access view's primary subject) we use a "scope pin": same blue
 * accent so the sidebars feel like the same product, but a circular
 * node-marker shape that can never be confused with a folder. The
 * outer ring + inner dot is a common cartography / network-node
 * idiom and reads as "an endpoint at this path".
 */
export const ScopePinGlyph = ({ size = 16 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
    <circle cx="8" cy="8" r="5.25" fill="var(--po-accent)" fillOpacity="0.18" stroke="var(--po-accent)" strokeOpacity="0.75" strokeWidth="1.25" />
    <circle cx="8" cy="8" r="1.75" fill="var(--po-accent)" fillOpacity="0.95" />
  </svg>
);
export const FileGlyph = ({ size = 11, color = T.text3 }: { readonly size?: number; readonly color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);
export const CopyIcon = ({ size = 12 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
