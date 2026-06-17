import { NextRequest, NextResponse } from 'next/server';
import { getServerApiBaseUrl } from '@/lib/server-env';

export const runtime = 'nodejs';
export const maxDuration = 300;

const API_BASE_URL = getServerApiBaseUrl();

/**
 * Proxy for Upload endpoints to the Python backend.
 *
 * Browser uploads use this same-origin route to avoid CORS and system-proxy
 * issues during multipart transfer.
 *
 * Usage:
 *   POST /api/upload?path=init            -> POST backend/api/v1/upload/init
 *   PUT  /api/upload?path=part&task_id=1 -> PUT  backend/api/v1/upload/part
 *   POST /api/upload?path=complete        -> POST backend/api/v1/upload/complete
 */

function buildBackendUrl(request: NextRequest): string {
  const { searchParams } = new URL(request.url);
  const subpath = searchParams.get('path') || 'init';

  const backendParams = new URLSearchParams();
  searchParams.forEach((value, key) => {
    if (key !== 'path') backendParams.set(key, value);
  });
  const qs = backendParams.toString();
  return `${API_BASE_URL}/api/v1/upload/${subpath}${qs ? `?${qs}` : ''}`;
}

function forwardHeaders(request: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  const authorization = request.headers.get('authorization');
  const contentType = request.headers.get('content-type');
  const contentLength = request.headers.get('content-length');
  if (authorization) headers.Authorization = authorization;
  if (contentType) headers['Content-Type'] = contentType;
  if (contentLength) headers['Content-Length'] = contentLength;
  return headers;
}

async function proxy(request: NextRequest, method: 'GET' | 'POST' | 'PUT' | 'DELETE') {
  try {
    const backendUrl = buildBackendUrl(request);
    const headers = forwardHeaders(request);

    const response = await fetch(backendUrl, {
      method,
      headers,
      body: method === 'GET' || method === 'DELETE' ? undefined : request.body,
      // @ts-expect-error -- Node.js fetch supports duplex for streaming bodies
      duplex: method === 'GET' || method === 'DELETE' ? undefined : 'half',
    });

    const responseBody = await response.text();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (error: any) {
    console.error(`[upload proxy] ${method} failed:`, error?.message || error);
    return NextResponse.json(
      { error: 'Backend request failed', detail: error?.message || 'Unknown error' },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  return proxy(request, 'POST');
}

export async function PUT(request: NextRequest) {
  return proxy(request, 'PUT');
}

export async function GET(request: NextRequest) {
  return proxy(request, 'GET');
}

export async function DELETE(request: NextRequest) {
  return proxy(request, 'DELETE');
}

