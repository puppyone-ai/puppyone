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

// ============ Analytics ============

/**
 * 获取当前用户的所有消息（用于 dashboard 统计）
 */
export async function getAllChatMessages(): Promise<ChatMessage[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // 先获取用户的所有 session ids
  const { data: sessions, error: sessionsError } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('user_id', user.id);

  if (sessionsError) throw sessionsError;
  if (!sessions || sessions.length === 0) return [];

  const sessionIds = sessions.map(s => s.id);

  // 获取这些 sessions 的所有消息
  const { data: messages, error: messagesError } = await supabase
    .from('chat_messages')
    .select('*')
    .in('session_id', sessionIds)
    .order('created_at', { ascending: false });

  if (messagesError) throw messagesError;
  return messages || [];
}

/**
 * Agent Log 类型
 */
export interface AgentLog {
  id: string;
  created_at: string;
  user_id: string | null;
  agent_id: string | null;
  session_id: string | null;
  call_type: 'bash' | 'tool' | 'llm';
  success: boolean;
  latency_ms: number | null;
  error_message: string | null;
  details: any;
}

/**
 * 获取指定项目的所有 Agent Logs（bash executions 等）
 * @param projectId 项目 ID
 */
export async function getAgentLogs(projectId: string): Promise<AgentLog[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // 1. 先获取该项目下的所有 agent IDs
  const { data: agents, error: agentsError } = await supabase
    .from('agents')
    .select('id')
    .eq('project_id', projectId);

  if (agentsError) throw agentsError;
  
  const agentIds = agents?.map(a => a.id) || [];
  
  if (agentIds.length === 0) {
    return []; // 没有 agents，就没有 logs
  }

  // 2. 获取这些 agents 的 logs
  const { data, error } = await supabase
    .from('agent_logs')
    .select('*')
    .in('agent_id', agentIds)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
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

// ============ Dashboard RPC ============

/**
 * Dashboard 聚合数据类型
 */
export interface DashboardData {
  // 总计统计
  totalAgents: number;
  totalSessions: number;
  totalBash: number;
  totalTools: number;
  totalMessages: number;
  activeAgents: number;
  
  // 时间范围内统计
  bashInRange: number;
  toolsInRange: number;
  messagesInRange: number;
  sessionsInRange: number;
  
  // 按小时聚合（时间序列）
  bashPerHour: { bucket: string; count: number }[];
  toolsPerHour: { bucket: string; count: number }[];
  messagesPerHour: { bucket: string; count: number }[];
  sessionsPerHour: { bucket: string; count: number }[];
  
  // Agent 列表（带统计）
  agents: {
    id: string;
    name: string;
    icon: string | null;
    agent_type: string;
    created_at: string;
    chat_count: number;
    last_active: string | null;
    bash_count: number;
    data_access_count: number;
  }[];
}

/**
 * 获取 Dashboard 聚合数据（按 project_id 过滤）
 * @param projectId 项目 ID（必填）
 * @param hours 时间范围（小时），默认 24
 */
export async function getDashboardData(projectId: string, hours: number = 24): Promise<DashboardData> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  if (!projectId) throw new Error('Project ID is required');

  const timeStart = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  // Step 1: 先获取该项目下的所有 agents
  const agentsResult = await supabase
    .from('agents')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  
  if (agentsResult.error) throw new Error(`Failed to fetch agents: ${agentsResult.error.message}`);
  const agents = agentsResult.data || [];
  const agentIds = agents.map(a => a.id);

  // Step 2: 并行获取与这些 agents 相关的数据
  const [
    sessionsResult,
    messagesResult,
    logsResult,
  ] = await Promise.all([
    // sessions: 只获取属于这个项目 agents 的 sessions
    agentIds.length > 0 
      ? supabase.from('chat_sessions').select('*').in('agent_id', agentIds)
      : Promise.resolve({ data: [], error: null }),
    // messages: RLS 自动过滤
    supabase.from('chat_messages').select('id, session_id, created_at'),
    // logs: 只获取属于这个项目 agents 的 logs
    agentIds.length > 0
      ? supabase.from('agent_logs').select('id, call_type, agent_id, created_at').in('agent_id', agentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  // 检查错误
  if (sessionsResult.error) throw new Error(`Failed to fetch sessions: ${sessionsResult.error.message}`);
  if (messagesResult.error) throw new Error(`Failed to fetch messages: ${messagesResult.error.message}`);
  if (logsResult.error) throw new Error(`Failed to fetch logs: ${logsResult.error.message}`);

  const sessions = sessionsResult.data || [];
  const allMessages = messagesResult.data || [];
  const logs = logsResult.data || [];

  // sessions 已经按 agent_id 过滤，都是有效的
  const validSessions = sessions;
  
  // 过滤有效 messages（属于这个项目 sessions 的）
  const sessionIds = new Set(sessions.map(s => s.id));
  const messages = allMessages.filter(m => sessionIds.has(m.session_id));

  // 计算聚合数据
  const bashLogs = logs.filter(l => l.call_type === 'bash');
  const toolLogs = logs.filter(l => l.call_type === 'tool');

  // 时间范围内的数据
  const inRange = (item: { created_at: string }) => new Date(item.created_at) >= new Date(timeStart);
  const bashInRange = bashLogs.filter(inRange);
  const toolsInRange = toolLogs.filter(inRange);
  const messagesInRange = messages.filter(inRange);
  const sessionsInRange = validSessions.filter(inRange);

  // 按小时聚合
  const aggregateByHour = (items: { created_at: string }[]) => {
    const buckets: Record<string, number> = {};
    items.filter(inRange).forEach(item => {
      const hour = new Date(item.created_at);
      hour.setMinutes(0, 0, 0);
      const key = hour.toISOString();
      buckets[key] = (buckets[key] || 0) + 1;
    });
    return Object.entries(buckets).map(([bucket, count]) => ({ bucket, count })).sort((a, b) => a.bucket.localeCompare(b.bucket));
  };

  // 构建 Agent 列表（带统计）
  const agentsWithStats = agents.map(a => {
    const agentSessions = sessions.filter(s => s.agent_id === a.id);
    const agentBashLogs = bashLogs.filter(l => l.agent_id === a.id);
    const lastSession = agentSessions.sort((x, y) => new Date(y.updated_at).getTime() - new Date(x.updated_at).getTime())[0];
    
    return {
      id: a.id,
      name: a.name,
      icon: a.icon,
      agent_type: a.type,
      created_at: a.created_at,
      chat_count: agentSessions.length,
      last_active: lastSession?.updated_at || null,
      bash_count: agentBashLogs.length,
      data_access_count: (a.bash_accesses?.length || 0) + (a.accesses?.length || 0),
    };
  });

  return {
    totalAgents: agents.length,
    totalSessions: validSessions.length,
    totalBash: bashLogs.length,
    totalTools: toolLogs.length,
    totalMessages: messages.length,
    activeAgents: new Set(validSessions.map(s => s.agent_id)).size,
    bashInRange: bashInRange.length,
    toolsInRange: toolsInRange.length,
    messagesInRange: messagesInRange.length,
    sessionsInRange: sessionsInRange.length,
    bashPerHour: aggregateByHour(bashLogs),
    toolsPerHour: aggregateByHour(toolLogs),
    messagesPerHour: aggregateByHour(messages),
    sessionsPerHour: aggregateByHour(validSessions),
    agents: agentsWithStats,
  };
}
