import { NextRequest } from 'next/server';
import { getServerApiBaseUrl } from '@/lib/server-env';
export const runtime = 'nodejs';
export const maxDuration = 300;

const API_BASE_URL = getServerApiBaseUrl();

export async function POST(request: NextRequest) {
  const requestBody = await request.text();
  const authorization = request.headers.get('authorization');

  const response = await fetch(`${API_BASE_URL}/api/v1/agents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: requestBody,
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type':
        response.headers.get('Content-Type') || 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
