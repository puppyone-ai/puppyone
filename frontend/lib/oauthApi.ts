import { API_BASE_URL } from "@/config/api";
import { getApiAccessToken } from "./apiClient";

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

export interface NotionDisconnectResponse {
  success: boolean;
  message: string;
}

/**
 * Get Notion OAuth authorization URL
 */
export async function getNotionAuthUrl(): Promise<string> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/notion/authorize`, {
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

    // Handle both direct response and ApiResponse wrapped response
    if (data.authorization_url) {
      return data.authorization_url;
    } else if (data.data && data.data.authorization_url) {
      return data.data.authorization_url;
    } else {
      throw new Error("Invalid response from server: authorization_url not found");
    }
  } catch (error) {
    console.error("Error getting Notion auth URL:", error);

    // Provide more specific error messages
    if (error instanceof Error && error.message.includes('500')) {
      throw new Error("Notion OAuth is not properly configured. Please check server configuration.");
    }

    throw error;
  }
}

/**
 * Handle Notion OAuth callback
 */
export async function notionCallback(code: string, provider: string = "notion"): Promise<NotionCallbackResponse> {
  const token = await getApiAccessToken();

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/notion/callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
      body: JSON.stringify({
        code,
        state: provider,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to handle callback: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error("Error handling Notion callback:", error);
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
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Failed to get Notion status: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error("Error getting Notion status:", error);
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
    const response = await fetch(`${API_BASE_URL}/api/v1/oauth/notion/disconnect`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Failed to disconnect Notion: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error("Error disconnecting Notion:", error);
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
    console.error("Error initiating Notion OAuth flow:", error);
    throw error;
  }
}

/**
 * Handle OAuth redirect callback from browser
 */
export function handleOAuthRedirect(): { code: string | null; state: string | null } {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get("code");
  const state = urlParams.get("state");

  return { code, state };
}