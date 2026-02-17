import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090';

/**
 * Proxy for ingest endpoints to the Python backend.
 *
 * The browser sends requests to this same-origin route, which forwards
 * them to the Python backend. This avoids CORS and system-proxy issues
 * that can break cross-origin multipart uploads.
 *
 * Usage:
 *   POST /api/ingest?path=submit/file   → POST backend/api/v1/ingest/submit/file
 *   POST /api/ingest?path=tasks/batch   → POST backend/api/v1/ingest/tasks/batch
 *   GET  /api/ingest?path=health        → GET  backend/api/v1/ingest/health
 *   GET  /api/ingest?path=tasks/123&source_type=file
 *        → GET backend/api/v1/ingest/tasks/123?source_type=file
 */

function buildBackendUrl(request: NextRequest): string {
  const { searchParams } = new URL(request.url);
  const subpath = searchParams.get('path') || 'submit/file';

  // Forward remaining query params (exclude 'path' itself)
  const backendParams = new URLSearchParams();
  searchParams.forEach((value, key) => {
    if (key !== 'path') backendParams.set(key, value);
  });
  const qs = backendParams.toString();
  return `${API_BASE_URL}/api/v1/ingest/${subpath}${qs ? `?${qs}` : ''}`;
}

function forwardHeaders(request: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  const authorization = request.headers.get('authorization');
  const contentType = request.headers.get('content-type');
  if (authorization) headers['Authorization'] = authorization;
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

export async function POST(request: NextRequest) {
  try {
    const backendUrl = buildBackendUrl(request);
    const headers = forwardHeaders(request);

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers,
      body: request.body,
      // @ts-expect-error -- Node.js fetch supports duplex for streaming bodies
      duplex: 'half',
    });

    const responseBody = await response.text();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (error: any) {
    console.error('[ingest proxy] POST failed:', error?.message || error);
    return NextResponse.json(
      { error: 'Backend request failed', detail: error?.message || 'Unknown error' },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const backendUrl = buildBackendUrl(request);
    const headers = forwardHeaders(request);

    const response = await fetch(backendUrl, {
      method: 'GET',
      headers,
    });

    const responseBody = await response.text();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (error: any) {
    console.error('[ingest proxy] GET failed:', error?.message || error);
    return NextResponse.json(
      { error: 'Backend request failed', detail: error?.message || 'Unknown error' },
      { status: 502 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const backendUrl = buildBackendUrl(request);
    const headers = forwardHeaders(request);

    const response = await fetch(backendUrl, {
      method: 'DELETE',
      headers,
    });

    const responseBody = await response.text();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (error: any) {
    console.error('[ingest proxy] DELETE failed:', error?.message || error);
    return NextResponse.json(
      { error: 'Backend request failed', detail: error?.message || 'Unknown error' },
      { status: 502 },
    );
  }
}
