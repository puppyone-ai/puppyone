/**
 * Chat API — all operations go through the backend REST API.
 * No direct Supabase access.
 */

import { apiRequest, getApiAccessToken } from './apiClient';

// ============ Types ============

export interface ChatSession {
  id: string;
  agent_id: string | null;
  title: string | null;
  mode: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessagePart {
  type: 'text' | 'tool';
  content?: string;
  toolId?: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  toolStatus?: 'running' | 'completed' | 'error';
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string | null;
  parts: MessagePart[] | null;
  created_at: string;
}

// ============ Session APIs ============

export async function getChatSessions(agentId: string): Promise<ChatSession[]> {
  return apiRequest<ChatSession[]>(
    `/api/v1/chat/sessions?agent_id=${encodeURIComponent(agentId)}`
  );
}

export async function createChatSession(agentId: string, title?: string): Promise<ChatSession> {
  return apiRequest<ChatSession>('/api/v1/chat/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: agentId, title: title || null }),
  });
}

export async function updateChatSessionTitle(
  sessionId: string,
  title: string
): Promise<ChatSession> {
  return apiRequest<ChatSession>(`/api/v1/chat/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  await apiRequest(`/api/v1/chat/sessions/${sessionId}`, { method: 'DELETE' });
}

// ============ Message APIs ============

export async function getChatMessages(sessionId: string): Promise<ChatMessage[]> {
  return apiRequest<ChatMessage[]>(
    `/api/v1/chat/sessions/${sessionId}/messages`
  );
}

/**
 * Send a message via the agent SSE endpoint.
 * Returns the raw fetch Response for SSE streaming.
 */
export async function sendChatMessage(
  sessionId: string,
  agentId: string,
  prompt: string,
  opts?: {
    activeToolIds?: string[];
  }
): Promise<Response> {
  const token = await getApiAccessToken();
  return fetch('/api/agent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      prompt,
      session_id: sessionId,
      agent_id: agentId,
      active_tool_ids: opts?.activeToolIds?.length ? opts.activeToolIds : undefined,
    }),
  });
}
