// Centralized server-only environment variables for PuppyFlow
// Do not import this file in client components

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required server environment variable: ${name}`);
  }
  return value;
}

export const SERVER_ENV = {
  USER_SYSTEM_BACKEND: requireEnv('USER_SYSTEM_BACKEND'),
  // Optional service key for S2S auth; not all routes need it
  USER_SYSTEM_SERVICE_KEY: process.env.USER_SYSTEM_SERVICE_KEY || '',
};


