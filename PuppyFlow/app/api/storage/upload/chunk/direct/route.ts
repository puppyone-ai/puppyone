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
  const url = new URL(req.url);
  const target = `${base}/upload/chunk/direct${url.search}`;

  const contentType = req.headers.get('content-type') || 'application/octet-stream';
  const auth = getAuthHeader();

  const upstream = await fetch(target, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      ...(auth ? { authorization: auth } : {}),
    },
    body: req.body,
  });

  const resHeaders = new Headers();
  const upstreamCT = upstream.headers.get('content-type') || 'application/json';
  resHeaders.set('content-type', upstreamCT);
  return new Response(upstream.body, { status: upstream.status, headers: resHeaders });
}
