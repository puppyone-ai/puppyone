const DEFAULT_PUBLIC_API_URL = 'http://localhost:9090';
const DEFAULT_PUBLIC_SUPABASE_URL = 'http://localhost:8000';

export function getServerApiBaseUrl(): string {
  return (
    process.env.API_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    DEFAULT_PUBLIC_API_URL
  );
}

export function getServerSupabaseUrl(): string {
  return (
    process.env.SUPABASE_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    DEFAULT_PUBLIC_SUPABASE_URL
  );
}

export function getSupabaseAnonKey(): string {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY must be set');
  }
  return anonKey;
}
