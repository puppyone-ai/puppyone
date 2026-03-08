import useSWR, { mutate } from 'swr';
import {
  getChatSessions,
  getChatMessages,
  createChatSession,
  updateChatSessionTitle,
  deleteChatSession,
  type ChatSession,
  type ChatMessage,
  type MessagePart,
} from '../chatApi';

// ============ Hooks ============

/**
 * Fetch sessions for a specific agent.
 * agentId is required — no more "playground" mode.
 */
export function useChatSessions(agentId: string | null | undefined) {
  const cacheKey = agentId ? `chat-sessions-${agentId}` : null;

  const { data, error, isLoading } = useSWR<ChatSession[]>(
    cacheKey,
    () => getChatSessions(agentId!),
    { revalidateOnFocus: false, dedupingInterval: 3000 }
  );

  return { sessions: data || [], isLoading, error };
}

/**
 * Fetch messages for a specific session.
 */
export function useChatMessages(sessionId: string | null) {
  const { data, error, isLoading } = useSWR<ChatMessage[]>(
    sessionId ? ['chat-messages', sessionId] : null,
    () => getChatMessages(sessionId!),
    { revalidateOnFocus: false, dedupingInterval: 3000 }
  );

  return { messages: data || [], isLoading, error };
}

// ============ Mutators ============

export function refreshChatSessions(agentId: string | null | undefined) {
  if (!agentId) return;
  return mutate(`chat-sessions-${agentId}`);
}

export function refreshChatMessages(sessionId: string) {
  return mutate(['chat-messages', sessionId]);
}

// ============ Actions ============

export async function createSession(agentId: string, title?: string): Promise<ChatSession> {
  const session = await createChatSession(agentId, title);
  await refreshChatSessions(agentId);
  return session;
}

export async function updateSessionTitle(
  sessionId: string,
  title: string,
  agentId?: string | null
): Promise<void> {
  await updateChatSessionTitle(sessionId, title);
  if (agentId) await refreshChatSessions(agentId);
}

export async function deleteSession(sessionId: string, agentId?: string | null): Promise<void> {
  await deleteChatSession(sessionId);
  if (agentId) await refreshChatSessions(agentId);
}

// Re-export types
export type { ChatSession, ChatMessage, MessagePart };
