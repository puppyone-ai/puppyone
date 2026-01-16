import { NextRequest } from 'next/server';
export const runtime = 'nodejs';
export const maxDuration = 300;

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090';

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
