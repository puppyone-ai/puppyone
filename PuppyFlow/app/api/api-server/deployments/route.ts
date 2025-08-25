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

function buildHeaders(): HeadersInit {
  const token = getUserToken();
  const useLocal = (process.env.NEXT_PUBLIC_DEPLOYMENT_TYPE || '').toLowerCase() === 'local';
  const finalToken = token || (useLocal ? 'local-token' : undefined);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (finalToken) {
    headers['x-user-token'] = `Bearer ${finalToken}`;
  }
  return headers;
}

export async function GET(req: NextRequest) {
  const apiBase = SYSTEM_URLS.API_SERVER.BASE;
  const url = new URL(req.url);

  // Accept some query params but ALWAYS force include_keys=false
  const qp = new URLSearchParams();
  const deploymentType = url.searchParams.get('deployment_type');
  const includeDetails = url.searchParams.get('include_details');
  if (deploymentType) qp.set('deployment_type', deploymentType);
  if (includeDetails) qp.set('include_details', includeDetails);
  qp.set('include_keys', 'false');

  const target = `${apiBase}/deployments${qp.toString() ? `?${qp.toString()}` : ''}`;

  const upstream = await fetch(target, {
    method: 'GET',
    headers: buildHeaders(),
    credentials: 'omit',
  });

  const resHeaders = new Headers();
  const contentType = upstream.headers.get('content-type') || 'application/json';
  resHeaders.set('content-type', contentType);

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    return new Response(text || JSON.stringify({ error: 'UPSTREAM_ERROR' }), {
      status: upstream.status,
      headers: resHeaders,
    });
  }

  // Sanitize keys from payload, regardless of upstream include_keys
  try {
    const data = await upstream.json();
    if (data && Array.isArray(data.deployments)) {
      data.deployments = data.deployments.map((d: any) => {
        const { api_key, chatbot_key, ...rest } = d || {};
        return rest;
      });
    }
    data.include_keys = false;
    return new Response(JSON.stringify(data), { status: 200, headers: resHeaders });
  } catch {
    // If not JSON, just pass through body
    const buffer = await upstream.arrayBuffer();
    return new Response(buffer, { status: 200, headers: resHeaders });
  }
}
