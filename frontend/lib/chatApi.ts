import { createBrowserClient } from '@supabase/ssr';

/**
 * Chat API - 直接操作 Supabase
 */

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ============ Types ============

export interface ChatSession {
  id: string;
  user_id: string;
  agent_id: string | null;  // 关联的 Agent ID
  title: string | null;
  mode: 'agent' | 'ask';
  created_at: string;
  updated_at: string;
}

export interface MessagePart {
  type: 'text' | 'tool';
  content?: string;
  toolId?: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string; // 工具执行结果
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

export interface CreateSessionInput {
  agent_id?: string | null;  // 关联的 Agent ID
  title?: string;
  mode?: 'agent' | 'ask';
}

export interface CreateMessageInput {
  session_id: string;
  role: 'user' | 'assistant';
  content?: string;
  parts?: MessagePart[];
}

// ============ Session APIs ============

/**
 * 获取当前用户指定 agent 的所有会话（按更新时间倒序）
 * @param agentId - Agent ID，如果为 null 则获取 playground 模式的会话
 */
export async function getChatSessions(agentId?: string | null): Promise<ChatSession[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  let query = supabase
    .from('chat_sessions')
    .select('*')
    .eq('user_id', user.id);

  // 按 agent_id 过滤
  if (agentId === undefined) {
    // 不传参数时返回所有会话（向后兼容）
  } else if (agentId === null) {
    // null 表示 playground 模式
    query = query.is('agent_id', null);
  } else {
    // 指定 agent
    query = query.eq('agent_id', agentId);
  }

  const { data, error } = await query.order('updated_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * 创建新会话
 */
export async function createChatSession(
  input?: CreateSessionInput
): Promise<ChatSession> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({
      user_id: user.id,
      agent_id: input?.agent_id || null,
      title: input?.title || null,
      mode: input?.mode || 'agent',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * 更新会话标题
 */
export async function updateChatSessionTitle(
  sessionId: string,
  title: string
): Promise<void> {
  const { error } = await supabase
    .from('chat_sessions')
    .update({ title })
    .eq('id', sessionId);

  if (error) throw error;
}

/**
 * 删除会话（会级联删除所有消息）
 */
export async function deleteChatSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('chat_sessions')
    .delete()
    .eq('id', sessionId);

  if (error) throw error;
}

// ============ Message APIs ============

/**
 * 获取会话的所有消息
 */
export async function getChatMessages(
  sessionId: string
): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * 添加消息
 */
export async function addChatMessage(
  input: CreateMessageInput
): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      session_id: input.session_id,
      role: input.role,
      content: input.content || null,
      parts: input.parts || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * 更新消息（用于流式更新 assistant 消息）
 */
export async function updateChatMessage(
  messageId: string,
  updates: { content?: string; parts?: MessagePart[] }
): Promise<void> {
  const { error } = await supabase
    .from('chat_messages')
    .update(updates)
    .eq('id', messageId);

  if (error) throw error;
}

/**
 * 删除消息
 */
export async function deleteChatMessage(messageId: string): Promise<void> {
  const { error } = await supabase
    .from('chat_messages')
    .delete()
    .eq('id', messageId);

  if (error) throw error;
}

// ============ Utility ============

/**
 * 从第一条用户消息生成会话标题
 */
export function generateSessionTitle(
  firstMessage: string,
  maxLen = 30
): string {
  const cleaned = firstMessage.replace(/\n/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.substring(0, maxLen) + '...';
}
