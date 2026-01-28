import useSWR, { mutate } from 'swr';
import {
  getChatSessions,
  getChatMessages,
  createChatSession,
  updateChatSessionTitle,
  deleteChatSession,
  addChatMessage,
  updateChatMessage,
  generateSessionTitle,
  type ChatSession,
  type ChatMessage,
  type MessagePart,
  type CreateSessionInput,
} from '../chatApi';

// ============ Hooks ============

/**
 * 获取当前用户指定 agent 的会话
 * @param agentId - Agent ID，null 表示 playground 模式
 */
export function useChatSessions(agentId?: string | null) {
  // 使用 agent_id 作为 key 的一部分，这样切换 agent 时会重新获取
  const cacheKey = agentId === undefined 
    ? 'chat-sessions-all' 
    : `chat-sessions-${agentId || 'playground'}`;

  const { data, error, isLoading } = useSWR<ChatSession[]>(
    cacheKey,
    () => getChatSessions(agentId),
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  return {
    sessions: data || [],
    isLoading,
    error,
  };
}

/**
 * 获取指定会话的消息
 */
export function useChatMessages(sessionId: string | null) {
  const { data, error, isLoading } = useSWR<ChatMessage[]>(
    sessionId ? ['chat-messages', sessionId] : null,
    () => getChatMessages(sessionId!),
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  return {
    messages: data || [],
    isLoading,
    error,
  };
}

// ============ Actions ============

/**
 * 刷新指定 agent 的会话列表
 */
export function refreshChatSessions(agentId?: string | null) {
  const cacheKey = agentId === undefined 
    ? 'chat-sessions-all' 
    : `chat-sessions-${agentId || 'playground'}`;
  return mutate(cacheKey);
}

/**
 * 刷新指定会话的消息
 */
export function refreshChatMessages(sessionId: string) {
  return mutate(['chat-messages', sessionId]);
}

/**
 * 创建新会话
 */
export async function createSession(
  input?: CreateSessionInput
): Promise<ChatSession> {
  const session = await createChatSession(input);
  await refreshChatSessions(input?.agent_id);
  return session;
}

/**
 * 更新会话标题
 */
export async function updateSessionTitle(
  sessionId: string,
  title: string
): Promise<void> {
  await updateChatSessionTitle(sessionId, title);
  await refreshChatSessions();
}

/**
 * 删除会话
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await deleteChatSession(sessionId);
  await refreshChatSessions();
}

/**
 * 添加用户消息
 */
export async function addUserMessage(
  sessionId: string,
  content: string
): Promise<ChatMessage> {
  const message = await addChatMessage({
    session_id: sessionId,
    role: 'user',
    content,
  });
  await refreshChatMessages(sessionId);
  return message;
}

/**
 * 添加 assistant 消息（初始空消息，用于流式填充）
 */
export async function addAssistantMessage(
  sessionId: string
): Promise<ChatMessage> {
  const message = await addChatMessage({
    session_id: sessionId,
    role: 'assistant',
    content: '',
    parts: [],
  });
  await refreshChatMessages(sessionId);
  return message;
}

/**
 * 更新 assistant 消息（流式更新）
 */
export async function updateAssistantMessage(
  messageId: string,
  content: string,
  parts: MessagePart[]
): Promise<void> {
  await updateChatMessage(messageId, { content, parts });
}

/**
 * 自动设置会话标题（如果还没有标题）
 */
export async function autoSetSessionTitle(
  sessionId: string,
  firstUserMessage: string
): Promise<void> {
  const title = generateSessionTitle(firstUserMessage);
  await updateChatSessionTitle(sessionId, title);
  await refreshChatSessions();
}

// Re-export types
export type { ChatSession, ChatMessage, MessagePart };
