import { API_BASE_URL } from '@/config/api';
import { getApiAccessToken } from './apiClient';

export interface NotionStatusResponse {
  connected: boolean;
  workspace_name?: string;
  connected_at?: string;
}

export interface NotionCallbackResponse {
  success: boolean;
  message: string;
  workspace_name?: string;
}

export interface GithubCallbackResponse {
  success: boolean;
  message: string;
  username?: string;
}

export interface NotionDisconnectResponse {
  success: boolean;
  message: string;
}

export interface GithubStatusResponse {
  connected: boolean;
  username?: string;
  connected_at?: string;
}

export interface GithubDisconnectResponse {
  success: boolean;
  message: string;
}

export interface GoogleSheetsStatusResponse {
  connected: boolean;
  workspace_name?: string;
  connected_at?: string;
}

export interface GoogleSheetsCallbackResponse {
  success: boolean;
  message: string;
  workspace_name?: string;
}

export interface GoogleSheetsDisconnectResponse {
  success: boolean;
  message: string;
}

export interface LinearStatusResponse {
  connected: boolean;
  workspace_name?: string;
  connected_at?: string;
}

export interface LinearCallbackResponse {
  success: boolean;
  message: string;
  workspace_name?: string;
}

export interface LinearDisconnectResponse {
  success: boolean;
  message: string;
}

export interface AirtableStatusResponse {
  connected: boolean;
  workspace_name?: string;
  connected_at?: string;
}

export interface AirtableCallbackResponse {
  success: boolean;
  message: string;
  workspace_name?: string;
}

export interface AirtableDisconnectResponse {
  success: boolean;
  message: string;
}

/**
 * Get Notion OAuth authorization URL
 */
export async function getNotionAuthUrl(): Promise<string> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/oauth/notion/authorize`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get authorization URL: ${response.status}`);
    }

    const data = await response.json();

    // Handle both direct response and ApiResponse wrapped response
    if (data.authorization_url) {
      return data.authorization_url;
    } else if (data.data && data.data.authorization_url) {
      return data.data.authorization_url;
    } else {
      throw new Error(
        'Invalid response from server: authorization_url not found'
      );
    }
  } catch (error) {
    console.error('Error getting Notion auth URL:', error);

    // Provide more specific error messages
    if (error instanceof Error && error.message.includes('500')) {
      throw new Error(
        'Notion OAuth is not properly configured. Please check server configuration.'
      );
    }

    throw error;
  }
}

/**
 * Handle Notion OAuth callback
 */
export async function notionCallback(
  code: string,
  provider: string = 'notion'
): Promise<NotionCallbackResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/oauth/notion/callback`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          code,
          state: provider,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to handle callback: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error handling Notion callback:', error);
    throw error;
  }
}

/**
 * Handle GitHub OAuth callback
 */
export async function githubCallback(
  code: string
): Promise<GithubCallbackResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/oauth/github/callback`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          code,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to handle GitHub callback: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error handling GitHub callback:', error);
    throw error;
  }
}

/**
 * Check Notion connection status
 */
export async function getNotionStatus(): Promise<NotionStatusResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/notion/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Failed to get Notion status: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error getting Notion status:', error);
    // Return disconnected status on error
    return {
      connected: false,
    };
  }
}

/**
 * Disconnect Notion integration
 */
export async function disconnectNotion(): Promise<NotionDisconnectResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/oauth/notion/disconnect`,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to disconnect Notion: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error disconnecting Notion:', error);
    throw error;
  }
}

/**
 * Initiate Notion OAuth flow
 */
export async function connectNotion(): Promise<void> {
  try {
    const authUrl = await getNotionAuthUrl();
    window.location.href = authUrl;
  } catch (error) {
    console.error('Error initiating Notion OAuth flow:', error);
    throw error;
  }
}

/**
 * Handle OAuth redirect callback from browser
 */
export function handleOAuthRedirect(): {
  code: string | null;
  state: string | null;
} {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const state = urlParams.get('state');

  return { code, state };
}

async function getGithubAuthUrl(): Promise<string> {
  const token = await getApiAccessToken();

  const response = await fetch(
    `${API_BASE_URL}/api/v1/oauth/github/authorize`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get authorization URL: ${response.status}`);
  }

  const data = await response.json();

  if (data.authorization_url) {
    return data.authorization_url;
  }
  if (data.data?.authorization_url) {
    return data.data.authorization_url;
  }
  throw new Error('Invalid response from server: authorization_url not found');
}

export async function connectGithub(): Promise<void> {
  try {
    const authUrl = await getGithubAuthUrl();
    window.location.href = authUrl;
  } catch (error) {
    console.error('Error initiating GitHub OAuth flow:', error);
    throw error;
  }
}

/**
 * 在 popup 窗口中打开 GitHub OAuth 授权
 * 授权完成后自动关闭 popup 并返回
 */
export async function connectGithubPopup(): Promise<boolean> {
  try {
    const authUrl = await getGithubAuthUrl();
    
    // 打开 popup 窗口
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    
    const popup = window.open(
      authUrl,
      'github-oauth',
      `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
    );
    
    if (!popup) {
      // Popup 被阻止，fallback 到跳转
      window.location.href = authUrl;
      return false;
    }
    
    // 等待 popup 关闭
    return new Promise((resolve) => {
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          // Popup 关闭了，检查是否授权成功
          resolve(true);
        }
      }, 500);
      
      // 30秒超时
      setTimeout(() => {
        clearInterval(checkClosed);
        if (!popup.closed) {
          popup.close();
        }
        resolve(false);
      }, 30000);
    });
  } catch (error) {
    console.error('Error initiating GitHub OAuth popup:', error);
    throw error;
  }
}

export async function getGithubStatus(): Promise<GithubStatusResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/github/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Failed to get GitHub status: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error getting GitHub status:', error);
    return { connected: false };
  }
}

export async function disconnectGithub(): Promise<GithubDisconnectResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/oauth/github/disconnect`,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to disconnect GitHub: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error disconnecting GitHub:', error);
    throw error;
  }
}

// Google Sheets OAuth functions
async function getGoogleSheetsAuthUrl(): Promise<string> {
  const token = await getApiAccessToken();

  const response = await fetch(
    `${API_BASE_URL}/api/v1/oauth/google-sheets/authorize`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get authorization URL: ${response.status}`);
  }

  const data = await response.json();

  if (data.authorization_url) {
    return data.authorization_url;
  }
  if (data.data?.authorization_url) {
    return data.data.authorization_url;
  }
  throw new Error('Invalid response from server: authorization_url not found');
}

export async function connectGoogleSheets(): Promise<void> {
  try {
    const authUrl = await getGoogleSheetsAuthUrl();
    window.location.href = authUrl;
  } catch (error) {
    console.error('Error initiating Google Sheets OAuth flow:', error);
    throw error;
  }
}

export async function googleSheetsCallback(
  code: string
): Promise<GoogleSheetsCallbackResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/oauth/google-sheets/callback`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          code,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to handle Google Sheets callback: ${response.status}`
      );
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error handling Google Sheets callback:', error);
    throw error;
  }
}

export async function getGoogleSheetsStatus(): Promise<GoogleSheetsStatusResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/oauth/google-sheets/status`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get Google Sheets status: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error getting Google Sheets status:', error);
    return { connected: false };
  }
}

export async function disconnectGoogleSheets(): Promise<GoogleSheetsDisconnectResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/oauth/google-sheets/disconnect`,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to disconnect Google Sheets: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error disconnecting Google Sheets:', error);
    throw error;
  }
}

// ========== Gmail OAuth functions ==========
export async function gmailCallback(code: string): Promise<{ success: boolean; message: string }> {
  const token = await getApiAccessToken();
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/gmail/callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({ code }),
    });
    if (!response.ok) {
      throw new Error(`Failed to handle Gmail callback: ${response.status}`);
    }
    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error handling Gmail callback:', error);
    throw error;
  }
}

export async function getGmailStatus(): Promise<{ connected: boolean; email?: string }> {
  const token = await getApiAccessToken();
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/gmail/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    });
    if (!response.ok) return { connected: false };
    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error getting Gmail status:', error);
    return { connected: false };
  }
}

export async function disconnectGmail(): Promise<void> {
  const token = await getApiAccessToken();
  await fetch(`${API_BASE_URL}/api/v1/oauth/gmail/disconnect`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
  });
}

// ========== Google Drive OAuth functions ==========
export async function googleDriveCallback(code: string): Promise<{ success: boolean; message: string }> {
  const token = await getApiAccessToken();
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/google-drive/callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({ code }),
    });
    if (!response.ok) {
      throw new Error(`Failed to handle Google Drive callback: ${response.status}`);
    }
    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error handling Google Drive callback:', error);
    throw error;
  }
}

export async function getGoogleDriveStatus(): Promise<{ connected: boolean; email?: string }> {
  const token = await getApiAccessToken();
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/google-drive/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    });
    if (!response.ok) return { connected: false };
    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error getting Google Drive status:', error);
    return { connected: false };
  }
}

// ========== Google Calendar OAuth functions ==========
export async function googleCalendarCallback(code: string): Promise<{ success: boolean; message: string }> {
  const token = await getApiAccessToken();
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/google-calendar/callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({ code }),
    });
    if (!response.ok) {
      throw new Error(`Failed to handle Google Calendar callback: ${response.status}`);
    }
    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error handling Google Calendar callback:', error);
    throw error;
  }
}

export async function getGoogleCalendarStatus(): Promise<{ connected: boolean; email?: string }> {
  const token = await getApiAccessToken();
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/google-calendar/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    });
    if (!response.ok) return { connected: false };
    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error getting Google Calendar status:', error);
    return { connected: false };
  }
}

// Linear OAuth functions
async function getLinearAuthUrl(): Promise<string> {
  const token = await getApiAccessToken();

  const response = await fetch(
    `${API_BASE_URL}/api/v1/oauth/linear/authorize`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get authorization URL: ${response.status}`);
  }

  const data = await response.json();

  if (data.authorization_url) {
    return data.authorization_url;
  }
  if (data.data?.authorization_url) {
    return data.data.authorization_url;
  }
  throw new Error('Invalid response from server: authorization_url not found');
}

export async function connectLinear(): Promise<void> {
  try {
    const authUrl = await getLinearAuthUrl();
    window.location.href = authUrl;
  } catch (error) {
    console.error('Error initiating Linear OAuth flow:', error);
    throw error;
  }
}

export async function linearCallback(
  code: string
): Promise<LinearCallbackResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/oauth/linear/callback`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          code,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to handle Linear callback: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error handling Linear callback:', error);
    throw error;
  }
}

export async function getLinearStatus(): Promise<LinearStatusResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/linear/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Failed to get Linear status: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error getting Linear status:', error);
    return { connected: false };
  }
}

export async function disconnectLinear(): Promise<LinearDisconnectResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/oauth/linear/disconnect`,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to disconnect Linear: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error disconnecting Linear:', error);
    throw error;
  }
}

// Airtable OAuth functions
async function getAirtableAuthUrl(): Promise<string> {
  const token = await getApiAccessToken();

  const response = await fetch(
    `${API_BASE_URL}/api/v1/oauth/airtable/authorize`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get authorization URL: ${response.status}`);
  }

  const data = await response.json();

  if (data.authorization_url) {
    return data.authorization_url;
  }
  if (data.data?.authorization_url) {
    return data.data.authorization_url;
  }
  throw new Error('Invalid response from server: authorization_url not found');
}

export async function connectAirtable(): Promise<void> {
  try {
    const authUrl = await getAirtableAuthUrl();
    window.location.href = authUrl;
  } catch (error) {
    console.error('Error initiating Airtable OAuth flow:', error);
    throw error;
  }
}

export async function airtableCallback(
  code: string,
  state?: string
): Promise<AirtableCallbackResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/oauth/airtable/callback`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          code,
          state,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to handle Airtable callback: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error handling Airtable callback:', error);
    throw error;
  }
}

export async function getAirtableStatus(): Promise<AirtableStatusResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/oauth/airtable/status`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get Airtable status: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error getting Airtable status:', error);
    return { connected: false };
  }
}

export async function disconnectAirtable(): Promise<AirtableDisconnectResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/v1/oauth/airtable/disconnect`,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to disconnect Airtable: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error disconnecting Airtable:', error);
    throw error;
  }
}

// ========== Google Docs OAuth functions ==========
export async function googleDocsCallback(code: string): Promise<{ success: boolean; message: string }> {
  const token = await getApiAccessToken();
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/google-docs/callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({ code }),
    });
    if (!response.ok) {
      throw new Error(`Failed to handle Google Docs callback: ${response.status}`);
    }
    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error handling Google Docs callback:', error);
    throw error;
  }
}

export async function getGoogleDocsStatus(): Promise<{ connected: boolean; email?: string }> {
  const token = await getApiAccessToken();
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/google-docs/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    });
    if (!response.ok) return { connected: false };
    const data = await response.json();
    return { connected: data.data?.connected, email: data.data?.workspace_name };
  } catch (error) {
    console.error('Error getting Google Docs status:', error);
    return { connected: false };
  }
}

export async function disconnectGoogleDocs(): Promise<void> {
  const token = await getApiAccessToken();
  await fetch(`${API_BASE_URL}/api/v1/oauth/google-docs/disconnect`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
  });
}

// ========== SAAS 类型映射 ==========
type SaasType = 'notion' | 'github' | 'sheets' | 'gmail' | 'drive' | 'calendar' | 'docs' | 'linear' | 'airtable';

// 通用的 OAuth URL 获取函数
async function getOAuthUrl(endpoint: string): Promise<string> {
  const token = await getApiAccessToken();
  const response = await fetch(`${API_BASE_URL}/api/v1/oauth/${endpoint}/authorize`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to get authorization URL: ${response.status}`);
  }
  const data = await response.json();
  return data.data?.authorization_url || data.authorization_url;
}

// OAuth URL 获取函数映射
const getAuthUrlMap: Record<SaasType, () => Promise<string>> = {
  notion: getNotionAuthUrl,
  github: () => getOAuthUrl('github'),
  sheets: () => getOAuthUrl('google-sheets'),
  gmail: () => getOAuthUrl('gmail'),
  drive: () => getOAuthUrl('google-drive'),
  calendar: () => getOAuthUrl('google-calendar'),
  docs: () => getOAuthUrl('google-docs'),
  linear: () => getOAuthUrl('linear'),
  airtable: () => getOAuthUrl('airtable'),
};

/**
 * 在 popup 窗口中打开 OAuth 授权
 * @param saasType - SaaS 类型
 * @returns Promise<boolean> - 用户是否完成了授权流程（关闭了 popup）
 */
export async function openOAuthPopup(saasType: SaasType): Promise<boolean> {
  const getAuthUrl = getAuthUrlMap[saasType];
  if (!getAuthUrl) {
    throw new Error(`Unknown SaaS type: ${saasType}`);
  }

  try {
    const authUrl = await getAuthUrl();
    
    // 打开 popup 窗口
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    
    const popup = window.open(
      authUrl,
      `${saasType}-oauth`,
      `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`
    );
    
    if (!popup) {
      // Popup 被阻止
      throw new Error('Popup blocked. Please allow popups and try again.');
    }
    
    // 等待 popup 关闭
    return new Promise((resolve) => {
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          resolve(true);
        }
      }, 500);
      
      // 60秒超时
      setTimeout(() => {
        clearInterval(checkClosed);
        if (!popup.closed) {
          popup.close();
        }
        resolve(false);
      }, 60000);
    });
  } catch (error) {
    console.error(`Error initiating ${saasType} OAuth popup:`, error);
    throw error;
  }
}

export type { SaasType };
