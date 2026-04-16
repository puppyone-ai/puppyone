/**
 * Centralized auth redirect URL configuration.
 *
 * All Supabase auth calls that trigger emails (signUp, resetPassword, OTP)
 * MUST use these helpers so the email links always point to the correct app.
 *
 * Priority chain for resolving the app origin:
 *   1. NEXT_PUBLIC_APP_URL  (explicit, recommended for production)
 *   2. NEXT_PUBLIC_SITE_URL (legacy alias, same purpose)
 *   3. window.location.origin (client-side fallback for local dev)
 *
 * Supabase validates redirect URLs against the project's "Redirect URLs"
 * allowlist. Make sure to add each environment's URLs there:
 *   - https://app.yoursite.com/auth/confirm
 *   - https://app.yoursite.com/auth/callback
 *   - http://localhost:3000/auth/confirm   (dev)
 *   - http://localhost:3000/auth/callback  (dev)
 */

function getAppOrigin(): string {
  const explicit =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');

  if (typeof window !== 'undefined') return window.location.origin;

  return 'http://localhost:3000';
}

/** Where Supabase should redirect after email confirmation (signup / email change). */
export function getEmailConfirmUrl(): string {
  return `${getAppOrigin()}/auth/confirm`;
}

/** Where Supabase should redirect after password-reset email link click. */
export function getPasswordResetRedirectUrl(): string {
  return `${getAppOrigin()}/auth/confirm?next=/reset-password`;
}

/** Where Supabase should redirect after OAuth provider authorization. */
export function getOAuthCallbackUrl(): string {
  return `${getAppOrigin()}/auth/callback`;
}
