import { NextRequest, NextResponse } from 'next/server';
import { getServerApiBaseUrl } from '@/lib/server-env';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const API_BASE_URL = getServerApiBaseUrl().replace(/\/+$/, '');
const PROXY_PREFIX = '/api/backend';
const REQUEST_HEADERS_TO_FORWARD = [
  'accept',
  'authorization',
  'content-type',
  'cookie',
  'if-modified-since',
  'if-none-match',
  'if-range',
  'range',
] as const;
const RESPONSE_HEADERS_TO_FORWARD = [
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-encoding',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
] as const;
const UPSTREAM_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_UPSTREAM_REDIRECTS = 4;

function buildBackendUrl(request: NextRequest): string {
  const pathname = request.nextUrl.pathname;
  const backendPath = pathname.startsWith(PROXY_PREFIX)
    ? pathname.slice(PROXY_PREFIX.length) || '/'
    : '/';

  if (!backendPath.startsWith('/api/')) {
    throw new Error(`Backend proxy only accepts /api/* paths, received ${backendPath}`);
  }

  return `${API_BASE_URL}${backendPath}${request.nextUrl.search}`;
}

function forwardRequestHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  for (const headerName of REQUEST_HEADERS_TO_FORWARD) {
    const value = request.headers.get(headerName);
    if (value) headers.set(headerName, value);
  }
  return headers;
}

function forwardResponseHeaders(response: Response): Headers {
  const headers = new Headers();
  for (const headerName of RESPONSE_HEADERS_TO_FORWARD) {
    const value = response.headers.get(headerName);
    if (value) headers.set(headerName, value);
  }
  return headers;
}

function resolveUpstreamRedirect(response: Response, currentUrl: string): string | null {
  if (!UPSTREAM_REDIRECT_STATUSES.has(response.status)) return null;
  const location = response.headers.get('location');
  if (!location) {
    throw new Error(`Backend returned HTTP ${response.status} without a Location header.`);
  }

  const nextUrl = new URL(location, currentUrl);
  const apiUrl = new URL(API_BASE_URL);
  // Compare HOST, not full origin. A backend behind a TLS-terminating reverse
  // proxy commonly emits SAME-HOST redirects (e.g. FastAPI's trailing-slash
  // 307/308) with the INTERNAL scheme `http`, even though we reached it over
  // `https`. A strict origin check rejects that as "outside origin" and
  // surfaces as a 502, breaking every endpoint that redirects. Allow same-host
  // redirects and pin the scheme back to the API base so we never downgrade.
  if (nextUrl.host !== apiUrl.host) {
    throw new Error(`Refusing backend redirect outside API host: ${nextUrl.host}`);
  }
  nextUrl.protocol = apiUrl.protocol;
  return nextUrl.toString();
}

async function proxy(request: NextRequest, method: string): Promise<Response> {
  let backendUrl: string;
  try {
    backendUrl = buildBackendUrl(request);
  } catch (error: any) {
    return NextResponse.json(
      {
        code: 400,
        message: error?.message || 'Invalid backend proxy path.',
        data: null,
      },
      { status: 400 },
    );
  }

  try {
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const requestHeaders = forwardRequestHeaders(request);
    const requestBody = hasBody ? await request.arrayBuffer() : undefined;
    let currentUrl = backendUrl;
    let currentMethod = method;
    let response: Response | null = null;

    for (let redirects = 0; redirects <= MAX_UPSTREAM_REDIRECTS; redirects += 1) {
      response = await fetch(currentUrl, {
        method: currentMethod,
        headers: requestHeaders,
        body: currentMethod !== 'GET' && currentMethod !== 'HEAD' ? requestBody : undefined,
        cache: 'no-store',
        redirect: 'manual',
      });

      const redirectUrl = resolveUpstreamRedirect(response, currentUrl);
      if (!redirectUrl) break;
      if (redirects === MAX_UPSTREAM_REDIRECTS) {
        throw new Error(`Backend redirect limit exceeded while proxying ${backendUrl}.`);
      }

      currentUrl = redirectUrl;
      if (response.status === 303) {
        currentMethod = 'GET';
        requestHeaders.delete('content-type');
      }
    }

    if (!response) {
      throw new Error('Backend proxy did not receive a response.');
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers: forwardResponseHeaders(response),
    });
  } catch (error: any) {
    console.error(`[backend proxy] ${method} ${backendUrl} failed:`, error?.message || error);
    let upstreamOrigin = backendUrl;
    try {
      upstreamOrigin = new URL(backendUrl).origin;
    } catch {
      // keep the full string if it isn't a valid URL
    }
    const usingDefault = upstreamOrigin.includes('localhost:9090');
    return NextResponse.json(
      {
        code: 502,
        message:
          `Unable to reach the backend API at ${upstreamOrigin} from the web app proxy` +
          (usingDefault
            ? ' — this is the localhost fallback, so API_INTERNAL_URL / NEXT_PUBLIC_API_URL is not set in the frontend deployment. Set API_INTERNAL_URL to the backend URL and redeploy.'
            : '. Check the backend is up and reachable from the frontend (API_INTERNAL_URL).'),
        detail: {
          upstream: backendUrl,
          reason: error?.message || 'Unknown error',
        },
        data: null,
      },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest) {
  return proxy(request, 'GET');
}

export async function POST(request: NextRequest) {
  return proxy(request, 'POST');
}

export async function PUT(request: NextRequest) {
  return proxy(request, 'PUT');
}

export async function PATCH(request: NextRequest) {
  return proxy(request, 'PATCH');
}

export async function DELETE(request: NextRequest) {
  return proxy(request, 'DELETE');
}

export async function HEAD(request: NextRequest) {
  return proxy(request, 'HEAD');
}
