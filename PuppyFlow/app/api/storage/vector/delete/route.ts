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

export async function POST(req: NextRequest) {
  const base = SYSTEM_URLS.PUPPY_STORAGE.BASE;
  const target = `${base}/vector/delete`;
  const body = await req.text();

  const auth = getAuthHeader();
  const upstream = await fetch(target, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
    body,
  });

  const resHeaders = new Headers();
  const upstreamCT = upstream.headers.get('content-type') || 'application/json';
  resHeaders.set('content-type', upstreamCT);
  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
}
