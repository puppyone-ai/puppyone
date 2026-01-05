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

  const response = await fetch(`${API_BASE_URL}/api/v1/oauth/google-sheets/authorize`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  });

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
  throw new Error("Invalid response from server: authorization_url not found");
}

export async function connectGoogleSheets(): Promise<void> {
  try {
    const authUrl = await getGoogleSheetsAuthUrl();
    window.location.href = authUrl;
  } catch (error) {
    console.error("Error initiating Google Sheets OAuth flow:", error);
    throw error;
  }
}

export async function googleSheetsCallback(code: string): Promise<GoogleSheetsCallbackResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/google-sheets/callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
      body: JSON.stringify({
        code,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to handle Google Sheets callback: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error("Error handling Google Sheets callback:", error);
    throw error;
  }
}

export async function getGoogleSheetsStatus(): Promise<GoogleSheetsStatusResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/google-sheets/status`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Failed to get Google Sheets status: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error("Error getting Google Sheets status:", error);
    return { connected: false };
  }
}

export async function disconnectGoogleSheets(): Promise<GoogleSheetsDisconnectResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/google-sheets/disconnect`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Failed to disconnect Google Sheets: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error("Error disconnecting Google Sheets:", error);
    throw error;
  }
}

// Linear OAuth functions
async function getLinearAuthUrl(): Promise<string> {
  const token = await getApiAccessToken();

  const response = await fetch(`${API_BASE_URL}/api/v1/oauth/linear/authorize`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  });

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
  throw new Error("Invalid response from server: authorization_url not found");
}

export async function connectLinear(): Promise<void> {
  try {
    const authUrl = await getLinearAuthUrl();
    window.location.href = authUrl;
  } catch (error) {
    console.error("Error initiating Linear OAuth flow:", error);
    throw error;
  }
}

export async function linearCallback(code: string): Promise<LinearCallbackResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/linear/callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
      body: JSON.stringify({
        code,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to handle Linear callback: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error("Error handling Linear callback:", error);
    throw error;
  }
}

export async function getLinearStatus(): Promise<LinearStatusResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/linear/status`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Failed to get Linear status: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error("Error getting Linear status:", error);
    return { connected: false };
  }
}

export async function disconnectLinear(): Promise<LinearDisconnectResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/linear/disconnect`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Failed to disconnect Linear: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error("Error disconnecting Linear:", error);
    throw error;
  }
}

// Airtable OAuth functions
async function getAirtableAuthUrl(): Promise<string> {
  const token = await getApiAccessToken();

  const response = await fetch(`${API_BASE_URL}/api/v1/oauth/airtable/authorize`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  });

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
  throw new Error("Invalid response from server: authorization_url not found");
}

export async function connectAirtable(): Promise<void> {
  try {
    const authUrl = await getAirtableAuthUrl();
    window.location.href = authUrl;
  } catch (error) {
    console.error("Error initiating Airtable OAuth flow:", error);
    throw error;
  }
}

export async function airtableCallback(code: string, state?: string): Promise<AirtableCallbackResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/airtable/callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
      body: JSON.stringify({
        code,
        state,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to handle Airtable callback: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error("Error handling Airtable callback:", error);
    throw error;
  }
}

export async function getAirtableStatus(): Promise<AirtableStatusResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/airtable/status`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Failed to get Airtable status: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error("Error getting Airtable status:", error);
    return { connected: false };
  }
}

export async function disconnectAirtable(): Promise<AirtableDisconnectResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/airtable/disconnect`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Failed to disconnect Airtable: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error("Error disconnecting Airtable:", error);
    throw error;
  }
}
