// Centralized server-only environment variables for PuppyFlow
// Do not import this file in client components

function requireEnv(name: string): string {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') {
    throw new Error(`Missing required server environment variable: ${name}`);
  }
  return raw;
}

function normalizeUrlBase(input: string): string {
  // Trim whitespace and stray quotes/semicolons, drop trailing slash
  let v = input.trim();
  // Remove leading/trailing common quotes and unicode quotes
  v = v.replace(/^[\s'"`“”‘’]+|[\s'"`“”‘’]+$/gu, '');
  // Remove trailing ASCII or full-width semicolons/commas and spaces
  v = v.replace(/[;；,，\s]+$/gu, '');
  // Remove single trailing slash (keep protocol slashes)
  v = v.replace(/\/$/, '');
  // Validate URL
  try {
    // Allow http/https only
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error('Only http/https are supported');
    }
  } catch (e) {
    throw new Error(`Invalid URL in server env: ${v}`);
  }
  return v;
}

// We only hard-require USER_SYSTEM_BACKEND when in cloud mode.
const mode = (process.env.DEPLOYMENT_MODE || '').toLowerCase();
const hasBackend = !!process.env.USER_SYSTEM_BACKEND;

export const SERVER_ENV = {
  USER_SYSTEM_BACKEND:
    mode === 'cloud'
      ? normalizeUrlBase(requireEnv('USER_SYSTEM_BACKEND'))
      : hasBackend
      ? normalizeUrlBase(process.env.USER_SYSTEM_BACKEND as string)
      : '',
  // Optional service key for S2S auth; not all routes need it
  SERVICE_KEY: process.env.SERVICE_KEY || '',
  // Allow bypassing service key for local/dev verification only
  ALLOW_VERIFY_WITHOUT_SERVICE_KEY:
    (process.env.ALLOW_VERIFY_WITHOUT_SERVICE_KEY || '').toLowerCase() === 'true',
  // Backend bases for internal proxies (server-only when provided)
  // Prefer server-only envs; fall back to public envs for local/dev convenience
  PUPPY_ENGINE_BACKEND: (() => {
    const server = process.env.PUPPYENGINE_URL || 'http://localhost:8001';
    return normalizeUrlBase(server as string);
  })(),
  PUPPY_STORAGE_BACKEND: (() => {
    const server = process.env.PUPPYSTORAGE_URL || 'http://localhost:8002';
    return normalizeUrlBase(server as string);
  })(),
  API_SERVER_BACKEND: (() => {
    const server = process.env.API_SERVER_URL || 'http://localhost:8004';
    return normalizeUrlBase(server as string);
  })(),
};


