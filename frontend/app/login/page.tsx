'use client';

import React, { useState, useCallback } from 'react';
import { useAuth } from '../supabase/SupabaseAuthProvider';
import { useRouter } from 'next/navigation';

type AuthView = 'main' | 'signin' | 'signup' | 'forgot';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9090';

export default function LoginPage() {
  const router = useRouter();
  const { signInWithProvider, signInWithEmail, signUpWithEmail, resendConfirmation, resetPassword } = useAuth();

  const [view, setView] = useState<AuthView>('main');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showResend, setShowResend] = useState(false);

  const clearFeedback = useCallback(() => {
    setError(null);
    setMessage(null);
  }, []);

  const goBack = useCallback(() => {
    setView('main');
    setPassword('');
    clearFeedback();
  }, [clearFeedback]);

  const handleOAuthSignIn = async (provider: 'google' | 'github') => {
    clearFeedback();
    setLoading(provider);
    try {
      await signInWithProvider(provider);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setLoading(null);
    }
  };

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    setLoading('continue');
    try {
      const resp = await fetch(`${API_BASE}/api/v1/auth/check-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = await resp.json();
      if (resp.status === 429) throw new Error('Too many attempts. Please wait a moment and try again.');
      if (!resp.ok) throw new Error(json.detail || 'Failed to check email');
      const exists = json.data?.exists;
      setView(exists ? 'signin' : 'signup');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(null);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    setShowResend(false);
    setLoading('password');
    try {
      await signInWithEmail(email, password);
      router.push('/home');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Sign-in failed';
      setError(msg);
      if (msg.toLowerCase().includes('email not confirmed')) {
        setShowResend(true);
      }
    } finally {
      setLoading(null);
    }
  };

  const handleResendConfirmation = async () => {
    clearFeedback();
    setShowResend(false);
    setLoading('resend');
    try {
      await resendConfirmation(email);
      setMessage('Confirmation email sent! Please check your inbox.');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to resend confirmation email');
    } finally {
      setLoading(null);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    setLoading('signup');
    try {
      const result = await signUpWithEmail(email, password);
      if (result.needsEmailConfirmation) {
        setMessage('Check your email for the confirmation link.');
        setPassword('');
      } else {
        router.push('/home');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Sign-up failed');
    } finally {
      setLoading(null);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();
    setLoading('forgot');
    try {
      await resetPassword(email);
      setMessage('Check your email for the password reset link.');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to send reset link');
    } finally {
      setLoading(null);
    }
  };

  const disabled = loading !== null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] text-[#ddd] p-6 font-sans">
      <div className="w-[380px] p-6">
        <div className="flex flex-col gap-2.5">
          {/* Back navigation — above logo, only on sub-views */}
          {view !== 'main' && (
            <div className="mb-2">
              <BackButton
                onClick={view === 'forgot' ? () => { clearFeedback(); setView('signin'); } : goBack}
                label={view === 'forgot' ? 'Back' : 'All sign in options'}
              />
            </div>
          )}

          {/* Global Logo */}
          <div className="flex justify-center mb-4">
            <img
              src="/puppyone-logo.svg"
              alt="PuppyOne"
              width={48}
              height={48}
              className="opacity-95"
            />
          </div>

          {/* ── Main View ── */}
          {view === 'main' && (
            <div className="animate-fade-in">
              <div className="mb-8 text-center">
                <h1 className="text-2xl font-semibold text-[#ededed]">Welcome to PuppyOne</h1>
                <p className="mt-2 text-sm text-[#a1a1aa]">The context hub for your agents.</p>
              </div>

              <div className="flex flex-col gap-3">
                <ProviderButton
                  icon={<GoogleIcon />}
                  label="Continue with Google"
                  loadingLabel="Redirecting..."
                  isLoading={loading === 'google'}
                  disabled={disabled}
                  onClick={() => handleOAuthSignIn('google')}
                />
                <ProviderButton
                  icon={<GithubIcon />}
                  label="Continue with GitHub"
                  loadingLabel="Redirecting..."
                  isLoading={loading === 'github'}
                  disabled={disabled}
                  onClick={() => handleOAuthSignIn('github')}
                />
              </div>

              <div className="mt-6">
                <form onSubmit={handleContinue} className="flex flex-col gap-3">
                  <InputField
                    label="Email"
                    type="email"
                    value={email}
                    onChange={setEmail}
                    placeholder="Your email address"
                    disabled={disabled}
                  />
                  <SubmitButton disabled={disabled}>
                    {loading === 'continue' ? 'Checking...' : 'Continue'}
                  </SubmitButton>
                </form>
              </div>

              <Feedback error={error} message={message} />
            </div>
          )}

          {/* ── Sign In View ── */}
          {view === 'signin' && (
            <div className="animate-fade-in">
              <div className="mb-6 text-center">
                <h2 className="text-xl font-semibold text-[#ededed]">Welcome back</h2>
                <p className="mt-1 text-sm text-[#a1a1aa]">{email}</p>
              </div>

              <form onSubmit={handleSignIn} className="flex flex-col gap-3">
                <InputField
                  label="Password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="Enter your password"
                  disabled={disabled}
                  minLength={6}
                  autoFocus
                />
                <SubmitButton disabled={disabled}>
                  {loading === 'password' ? 'Signing in...' : 'Sign In'}
                </SubmitButton>
              </form>

              <Feedback error={error} message={message} />

              {showResend && (
                <div className="mt-3">
                  <button
                    onClick={handleResendConfirmation}
                    disabled={disabled}
                    className="w-full h-10 px-4 rounded-md border border-[#2a2a2a] bg-[#141414] text-[#e6e6e6] cursor-pointer text-sm font-medium transition-all hover:bg-[#1f1f1f] hover:border-[#3a3a3a] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading === 'resend' ? 'Sending...' : 'Resend confirmation email'}
                  </button>
                </div>
              )}

              <div className="mt-4 text-center">
                <button
                  onClick={() => { clearFeedback(); setView('forgot'); }}
                  className="bg-transparent border-none text-[#888] hover:text-[#ccc] cursor-pointer text-sm p-0 transition-colors"
                >
                  Forgot password?
                </button>
              </div>
            </div>
          )}

          {/* ── Sign Up View ── */}
          {view === 'signup' && (
            <div className="animate-fade-in">
              <div className="mb-6 text-center">
                <h2 className="text-xl font-semibold text-[#ededed]">Create your account</h2>
                <p className="mt-1 text-sm text-[#a1a1aa]">{email}</p>
              </div>

              <form onSubmit={handleSignUp} className="flex flex-col gap-3">
                <InputField
                  label="Password"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  placeholder="Create a password"
                  disabled={disabled}
                  minLength={6}
                  autoFocus
                />
                <SubmitButton disabled={disabled}>
                  {loading === 'signup' ? 'Creating account...' : 'Create Account'}
                </SubmitButton>
              </form>

              <Feedback error={error} message={message} />
            </div>
          )}

          {/* ── Forgot Password View ── */}
          {view === 'forgot' && (
            <div className="animate-fade-in">
              <div className="mb-6 text-center">
                <h2 className="text-xl font-semibold text-[#ededed]">Reset your password</h2>
                <p className="mt-1 text-sm text-[#a1a1aa]">{email}</p>
              </div>

              <form onSubmit={handleForgotPassword} className="flex flex-col gap-3">
                <SubmitButton disabled={disabled}>
                  {loading === 'forgot' ? 'Sending...' : 'Send Reset Link'}
                </SubmitButton>
              </form>

              <Feedback error={error} message={message} />
            </div>
          )}

          {/* Terms */}
          <p className="text-[11px] text-[#555] text-center mt-4">
            By continuing you agree to our Terms and Privacy Policy.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Shared UI Components ─── */

function ProviderButton({
  icon, label, loadingLabel, isLoading, disabled, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  loadingLabel?: string;
  isLoading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full h-10 px-4 rounded-md border border-[#2a2a2a] bg-[#141414] text-[#e6e6e6] cursor-pointer text-sm font-medium transition-all hover:bg-[#1f1f1f] hover:border-[#3a3a3a] disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span className="flex items-center justify-center gap-2.5">
        {icon}
        <span>{isLoading ? loadingLabel : label}</span>
      </span>
    </button>
  );
}

function InputField({
  label, type, value, onChange, placeholder, disabled, minLength, autoFocus,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled?: boolean;
  minLength?: number;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#888] mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required
        disabled={disabled}
        minLength={minLength}
        autoFocus={autoFocus}
        className="w-full h-10 px-3 rounded-md border border-[#333] bg-[#0a0a0a] text-[#e6e6e6] text-sm outline-none box-border transition-colors focus:border-[#666] placeholder:text-[#444]"
      />
    </div>
  );
}

function SubmitButton({ disabled, children }: { disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full h-10 px-4 rounded-md border-none bg-[#ededed] text-[#0a0a0a] cursor-pointer text-sm font-semibold transition-all hover:bg-white hover:shadow-[0_0_12px_rgba(255,255,255,0.1)] disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function BackButton({ onClick, label = 'All sign in options' }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 bg-transparent border-none text-[#888] hover:text-[#ccc] cursor-pointer text-sm p-0 transition-colors self-start"
    >
      <ArrowLeftIcon />
      <span>{label}</span>
    </button>
  );
}

function Feedback({ error, message }: { error: string | null; message: string | null }) {
  if (!error && !message) return null;
  return (
    <div className="mt-3">
      {error && (
        <div className="text-[#f66] text-sm text-center px-3 py-2 bg-[rgba(255,102,102,0.08)] rounded-lg">
          {error}
        </div>
      )}
      {message && (
        <div className="text-[#6f6] text-sm text-center px-3 py-2 bg-[rgba(102,255,102,0.08)] rounded-lg">
          {message}
        </div>
      )}
    </div>
  );
}

/* ─── Icons ─── */

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 533.5 544.3" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="#4285f4" d="M533.5 278.4c0-17.6-1.6-34.4-4.6-50.4H272v95.3h147c-6.4 34.6-25.8 63.9-55 83.6l89 69.4c51.8-47.7 80.5-118 80.5-198z"/>
      <path fill="#34a853" d="M272 544.3c74.7 0 137.5-24.8 183.3-67.4l-89-69.4c-24.7 16.6-56.3 26.3-94.3 26.3-72.5 0-134-49-155.9-114.9l-92 71.6c41.6 82.5 127.1 153.8 247.9 153.8z"/>
      <path fill="#fbbc04" d="M116.1 318.9c-10-29.8-10-62.1 0-91.9l-92-71.6C4 211 0 240.9 0 272.4s4 61.4 24.1 116.9l92-70.4z"/>
      <path fill="#ea4335" d="M272 107.7c39.7-.6 77.6 14.7 105.8 42.9l77.5-77.5C395.1 24 334.2 0 272 0 151.2 0 65.7 71.3 24.1 155.5l92 71.6C138 161.3 199.5 107.7 272 107.7z"/>
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 1C6 1 1.5 5.5 1.5 11.5c0 4.6 3 8.5 7.2 9.9.5.1.7-.2.7-.5v-1.9c-2.9.6-3.5-1.2-3.5-1.2-.5-1.2-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1 1 1.7 2.6 1.2 3.2.9.1-.7.4-1.2.7-1.5-2.4-.3-4.9-1.2-4.9-5.3 0-1.2.4-2.1 1.1-2.9-.1-.3-.5-1.4.1-2.9 0 0 .9-.3 3 .1 1-.3 2-.4 3.1-.4s2.1.1 3.1.4c2.1-1.4 3-.1 3-.1.6 1.5.2 2.6.1 2.9.7.8 1.1 1.7 1.1 2.9 0 4.1-2.6 5.1-5 5.4.4.3.7 1 .7 2v3c0 .3.2.6.7.5 4.2-1.4 7.2-5.3 7.2-9.9C22.5 5.5 18 1 12 1z"/>
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}
