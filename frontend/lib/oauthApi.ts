import { API_BASE_URL } from '@/config/api';
import { getApiAccessToken } from './apiClient';

// ---------------------------------------------------------------------------
// Generic types
// ---------------------------------------------------------------------------

export interface OAuthStatusResponse {
  connected: boolean;
  workspace_name?: string;
  username?: string;
  email?: string;
  connected_at?: string;
}

export interface OAuthCallbackResponse {
  success: boolean;
  message: string;
  workspace_name?: string;
  username?: string;
}

export interface OAuthDisconnectResponse {
  success: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Provider registry — add a new provider by adding one line here
// ---------------------------------------------------------------------------

const OAUTH_PROVIDERS = {
  notion:          { slug: 'notion' },
  github:          { slug: 'github' },
  gmail:           { slug: 'gmail' },
  google_drive:    { slug: 'google-drive' },
  google_calendar: { slug: 'google-calendar' },
  google_sheets:   { slug: 'google-sheets' },
  google_docs:     { slug: 'google-docs' },
  linear:          { slug: 'linear' },
  airtable:        { slug: 'airtable' },
} as const;

export type SaasType = keyof typeof OAUTH_PROVIDERS;

// ---------------------------------------------------------------------------
// Low-level fetch helpers
// ---------------------------------------------------------------------------

async function oauthFetch<T>(
  path: string,
  method: 'GET' | 'POST' | 'DELETE',
  body?: Record<string, unknown>,
): Promise<T> {
  const token = await getApiAccessToken();
  const response = await fetch(`${API_BASE_URL}/api/v1/oauth/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    throw new Error(`OAuth request failed: ${method} ${path} → ${response.status}`);
  }
  const data = await response.json();
  return data.data ?? data;
}

async function oauthFetchSafe<T>(
  path: string,
  fallback: T,
): Promise<T> {
  try {
    return await oauthFetch<T>(path, 'GET');
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Factory — creates a full API for any OAuth provider
// ---------------------------------------------------------------------------

export interface OAuthProviderApi {
  getAuthUrl: () => Promise<string>;
  callback:   (code: string, extra?: Record<string, string>) => Promise<OAuthCallbackResponse>;
  getStatus:  () => Promise<OAuthStatusResponse>;
  disconnect: () => Promise<OAuthDisconnectResponse | void>;
}

function createOAuthApi(slug: string): OAuthProviderApi {
  return {
    getAuthUrl: async () => {
      const data = await oauthFetch<{ authorization_url?: string }>(
        `${slug}/authorize`, 'GET',
      );
      const url = (data as any).authorization_url ?? (data as any)?.data?.authorization_url;
      if (!url) throw new Error('authorization_url not found in response');
      return url as string;
    },
    callback: (code, extra) =>
      oauthFetch(`${slug}/callback`, 'POST', { code, ...extra }),
    getStatus: () =>
      oauthFetchSafe<OAuthStatusResponse>(`${slug}/status`, { connected: false }),
    disconnect: () =>
      oauthFetch(`${slug}/disconnect`, 'DELETE'),
  };
}

// ---------------------------------------------------------------------------
// Generated provider APIs
// ---------------------------------------------------------------------------

type OAuthProviderMap = { [K in SaasType]: OAuthProviderApi };

export const oauth: OAuthProviderMap = Object.fromEntries(
  Object.entries(OAUTH_PROVIDERS).map(([key, { slug }]) => [key, createOAuthApi(slug)]),
) as OAuthProviderMap;

// ---------------------------------------------------------------------------
// openOAuthPopup — universal popup-based OAuth flow
// ---------------------------------------------------------------------------

export async function openOAuthPopup(saasType: SaasType): Promise<boolean> {
  const provider = oauth[saasType];
  if (!provider) throw new Error(`Unknown SaaS type: ${saasType}`);

  const authUrl = await provider.getAuthUrl();

  const width = 600;
  const height = 700;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;

  const popup = window.open(
    authUrl,
    `${saasType}-oauth`,
    `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`,
  );

  if (!popup) {
    throw new Error('Popup blocked. Please allow popups and try again.');
  }

  return new Promise((resolve) => {
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed);
        resolve(true);
      }
    }, 500);

    setTimeout(() => {
      clearInterval(checkClosed);
      if (!popup.closed) popup.close();
      resolve(false);
    }, 60_000);
  });
}

// ---------------------------------------------------------------------------
// Backward-compatible named exports
// (so existing callers don't need to change their imports)
// ---------------------------------------------------------------------------

// --- Notion ---
export const getNotionAuthUrl  = () => oauth.notion.getAuthUrl();
export const notionCallback    = (code: string, provider?: string) =>
  oauth.notion.callback(code, provider ? { state: provider } : undefined);
export const getNotionStatus   = () => oauth.notion.getStatus();
export const disconnectNotion  = () => oauth.notion.disconnect();
export const connectNotion     = async () => { window.location.href = await oauth.notion.getAuthUrl(); };

// --- GitHub ---
export const getGithubStatus   = () => oauth.github.getStatus();
export const githubCallback    = (code: string) => oauth.github.callback(code);
export const disconnectGithub  = () => oauth.github.disconnect();
export const connectGithub     = async () => { window.location.href = await oauth.github.getAuthUrl(); };

// --- Gmail ---
export const gmailCallback     = (code: string) => oauth.gmail.callback(code);
export const getGmailStatus    = () => oauth.gmail.getStatus();
export const disconnectGmail   = () => oauth.gmail.disconnect();

// --- Google Drive ---
export const googleDriveCallback  = (code: string) => oauth.google_drive.callback(code);
export const getGoogleDriveStatus = () => oauth.google_drive.getStatus();

// --- Google Calendar ---
export const googleCalendarCallback  = (code: string) => oauth.google_calendar.callback(code);
export const getGoogleCalendarStatus = () => oauth.google_calendar.getStatus();

// --- Google Sheets ---
export const googleSheetsCallback    = (code: string) => oauth.google_sheets.callback(code);
export const getGoogleSheetsStatus   = () => oauth.google_sheets.getStatus();
export const disconnectGoogleSheets  = () => oauth.google_sheets.disconnect();
export const connectGoogleSheets     = async () => { window.location.href = await oauth.google_sheets.getAuthUrl(); };

// --- Google Docs ---
export const googleDocsCallback    = (code: string) => oauth.google_docs.callback(code);
export const getGoogleDocsStatus   = () => oauth.google_docs.getStatus();
export const disconnectGoogleDocs  = () => oauth.google_docs.disconnect();

// --- Linear ---
export const linearCallback    = (code: string) => oauth.linear.callback(code);
export const getLinearStatus   = () => oauth.linear.getStatus();
export const disconnectLinear  = () => oauth.linear.disconnect();
export const connectLinear     = async () => { window.location.href = await oauth.linear.getAuthUrl(); };

// --- Airtable ---
export const airtableCallback    = (code: string, state?: string) =>
  oauth.airtable.callback(code, state ? { state } : undefined);
export const getAirtableStatus   = () => oauth.airtable.getStatus();
export const disconnectAirtable  = () => oauth.airtable.disconnect();
export const connectAirtable     = async () => { window.location.href = await oauth.airtable.getAuthUrl(); };

// --- Legacy type aliases ---
export type GithubStatusResponse       = OAuthStatusResponse;
export type GithubCallbackResponse     = OAuthCallbackResponse;
export type GithubDisconnectResponse   = OAuthDisconnectResponse;
export type NotionStatusResponse       = OAuthStatusResponse;
export type NotionCallbackResponse     = OAuthCallbackResponse;
export type NotionDisconnectResponse   = OAuthDisconnectResponse;
export type GoogleSheetsStatusResponse = OAuthStatusResponse;
export type GoogleSheetsCallbackResponse  = OAuthCallbackResponse;
export type GoogleSheetsDisconnectResponse = OAuthDisconnectResponse;
export type LinearStatusResponse       = OAuthStatusResponse;
export type LinearCallbackResponse     = OAuthCallbackResponse;
export type LinearDisconnectResponse   = OAuthDisconnectResponse;
export type AirtableStatusResponse     = OAuthStatusResponse;
export type AirtableCallbackResponse   = OAuthCallbackResponse;
export type AirtableDisconnectResponse = OAuthDisconnectResponse;

// Legacy helper
export function handleOAuthRedirect(): { code: string | null; state: string | null } {
  const params = new URLSearchParams(window.location.search);
  return { code: params.get('code'), state: params.get('state') };
}
