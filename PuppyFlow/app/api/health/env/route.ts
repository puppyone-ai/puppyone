// Safe environment health endpoint
// Returns a summary of deployment mode and env injection status.
// Force dynamic to avoid static optimization in build output.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

export async function GET() {
  const rawMode = (process.env.DEPLOYMENT_MODE || '').toLowerCase();
  const deploymentType = rawMode === 'cloud' ? 'cloud' : 'local';

  const payload = {
    environment: {
      deploymentType,
      DEPLOYMENT_MODE: process.env.DEPLOYMENT_MODE || '(not set)',
      NODE_ENV: process.env.NODE_ENV || '(not set)',
    },
    serverEnvPresence: {
      USER_SYSTEM_FRONTEND_URL: !!process.env.USER_SYSTEM_FRONTEND_URL,
      USER_SYSTEM_BACKEND: !!process.env.USER_SYSTEM_BACKEND,
      PUPPYENGINE_URL: !!process.env.PUPPYENGINE_URL,
      PUPPYSTORAGE_URL: !!process.env.PUPPYSTORAGE_URL,
      API_SERVER_URL: !!process.env.API_SERVER_URL,
      SERVICE_KEY: !!process.env.SERVICE_KEY,
      ALLOW_VERIFY_WITHOUT_SERVICE_KEY:
        (process.env.ALLOW_VERIFY_WITHOUT_SERVICE_KEY || '').toLowerCase() ===
        'true',
    },
    publicClientEnv: {
      NEXT_PUBLIC_FRONTEND_VERSION:
        process.env.NEXT_PUBLIC_FRONTEND_VERSION || '(not set)',
      NEXT_PUBLIC_OLLAMA_ENDPOINT:
        process.env.NEXT_PUBLIC_OLLAMA_ENDPOINT || '(not set)',
    },
    serverTime: new Date().toISOString(),
  } as const;

  console.log('🐶 [PuppyFlow] /api/health/env check:', {
    deploymentType,
    hasBackend: !!process.env.USER_SYSTEM_BACKEND,
  });

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store, no-cache, must-revalidate',
    },
  });
}
