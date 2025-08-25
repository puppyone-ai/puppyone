import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { SYSTEM_URLS } from '@/config/urls';

function getAuthHeader(): string | undefined {
  try {
    const token = cookies().get('access_token')?.value;
    if (!token) return undefined;
    return `Bearer ${token}`;
  } catch {
    return undefined;
  }
}

export async function GET(req: NextRequest, context: { params: { taskId: string } }) {
  const base = SYSTEM_URLS.PUPPY_ENGINE.BASE;
  const { taskId } = context.params;
  const target = `${base}/get_data/${encodeURIComponent(taskId)}`;

  const auth = getAuthHeader();
  const upstream = await fetch(target, {
    method: 'GET',
    headers: {
      accept: 'text/event-stream',
      'cache-control': 'no-cache',
      ...(auth ? { authorization: auth } : {}),
    },
  });

  const headers = new Headers();
  headers.set('content-type', 'text/event-stream');
  headers.set('cache-control', 'no-cache');
  headers.set('connection', 'keep-alive');

  return new Response(upstream.body, { status: upstream.status, headers });
}
