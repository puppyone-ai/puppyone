import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
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

export async function POST(req: NextRequest) {
  const apiBase = SYSTEM_URLS.API_SERVER.BASE;
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const upstream = await fetch(`${apiBase}/create_chatbot`, {
    method: 'POST',
    headers: buildUserHeaders(),
    body: JSON.stringify(body || {}),
  });
  const resHeaders = new Headers();
  const contentType = upstream.headers.get('content-type') || 'application/json';
  resHeaders.set('content-type', contentType);
  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
}
