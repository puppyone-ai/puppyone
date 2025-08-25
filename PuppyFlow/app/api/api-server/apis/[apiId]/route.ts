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

export async function DELETE(_: NextRequest, context: { params: { apiId: string } }) {
  const apiBase = SYSTEM_URLS.API_SERVER.BASE;
  const { apiId } = context.params;
  const upstream = await fetch(`${apiBase}/delete_api/${encodeURIComponent(apiId)}`, {
    method: 'DELETE',
    headers: buildUserHeaders(),
  });
  return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' } });
}

export async function PUT(req: NextRequest, context: { params: { apiId: string } }) {
  const apiBase = SYSTEM_URLS.API_SERVER.BASE;
  const { apiId } = context.params;
  let body: any = {};
  try { body = await req.json(); } catch {}
  const upstream = await fetch(`${apiBase}/update_api/${encodeURIComponent(apiId)}`, {
    method: 'PUT',
    headers: buildUserHeaders(),
    body: JSON.stringify(body || {}),
  });
  return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') || 'application/json' } });
}
