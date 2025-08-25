import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { SYSTEM_URLS } from '@/config/urls';

function getUserToken(): string | undefined {
  try {
    return cookies().get('access_token')?.value;
  } catch {
    return undefined;
  }
}

function buildUserHeaders(): HeadersInit {
  const token = getUserToken();
  const useLocal = (process.env.NEXT_PUBLIC_DEPLOYMENT_TYPE || '').toLowerCase() === 'local';
  const finalToken = token || (useLocal ? 'local-token' : undefined);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (finalToken) headers['x-user-token'] = `Bearer ${finalToken}`;
  return headers;
}

async function fetchChatbotKey(apiBase: string, chatbotId: string, userHeaders: HeadersInit): Promise<string | undefined> {
  const u = `${apiBase}/deployments?include_keys=true&include_details=true&deployment_type=chatbot`;
  const res = await fetch(u, { method: 'GET', headers: userHeaders, credentials: 'omit' });
  if (!res.ok) return undefined;
  const data = await res.json().catch(() => ({}));
  const found = Array.isArray(data.deployments)
    ? data.deployments.find((d: any) => d && d.deployment_type === 'chatbot' && d.chatbot_id === chatbotId)
    : undefined;
  return found?.chatbot_key;
}

export async function POST(req: NextRequest, context: { params: { chatbotId: string } }) {
  const apiBase = SYSTEM_URLS.API_SERVER.BASE;
  const { chatbotId } = context.params;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { apiKeyOverride, ...forwardBody } = body || {};

  const userHeaders = buildUserHeaders();
  const chatbotKey = apiKeyOverride || (await fetchChatbotKey(apiBase, chatbotId, userHeaders));
  if (!chatbotKey) {
    return new Response(JSON.stringify({ error: 'CHATBOT_KEY_NOT_FOUND' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  const target = `${apiBase}/chat/${encodeURIComponent(chatbotId)}`;
  const upstream = await fetch(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${chatbotKey}` },
    body: JSON.stringify(forwardBody || {}),
  });

  const resHeaders = new Headers();
  const contentType = upstream.headers.get('content-type') || 'application/json';
  resHeaders.set('content-type', contentType);

  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
}
