'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '../supabase/SupabaseAuthProvider';
import { useRouter } from 'next/navigation';

type PageState = 'loading' | 'ready' | 'success' | 'no-session';

export default function ResetPasswordPage() {
  const router = useRouter();
  const { session, isAuthReady, updatePassword } = useAuth();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthReady) return;
    setPageState(session ? 'ready' : 'no-session');
  }, [isAuthReady, session]);

  const validate = (): string | null => {
    if (password.length < 6) return 'Password must be at least 6 characters.';
    if (password !== confirmPassword) return 'Passwords do not match.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const validationError = validate();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      await updatePassword(password);
      setPageState('success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update password';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (pageState === 'loading') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center', color: '#888', fontSize: 14 }}>
            Verifying...
          </div>
        </div>
      </div>
    );
  }

  if (pageState === 'no-session') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>🔗</div>
            <div style={{ fontSize: 16, fontWeight: 500, color: '#ccc', marginBottom: 8 }}>
              Invalid or Expired Link
            </div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 20, lineHeight: 1.5 }}>
              This password reset link is no longer valid. Please request a new one.
            </div>
            <button
              onClick={() => router.push('/login')}
              style={primaryBtnStyle}
              onMouseEnter={primaryHoverIn}
              onMouseLeave={primaryHoverOut}
            >
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (pageState === 'success') {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 500, color: '#ccc', marginBottom: 8 }}>
              Password Updated
            </div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 20, lineHeight: 1.5 }}>
              Your password has been successfully changed. You can now sign in with your new password.
            </div>
            <button
              onClick={() => router.push('/login')}
              style={primaryBtnStyle}
              onMouseEnter={primaryHoverIn}
              onMouseLeave={primaryHoverOut}
            >
              Continue to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <img
              src='/puppyone-logo.svg'
              alt='PuppyBase'
              width={64}
              height={64}
              style={{ opacity: 0.95, display: 'block', margin: '0 auto' }}
            />
            <div style={{ marginTop: 10, fontSize: 16, fontWeight: 500, color: '#999' }}>
              Set a new password
            </div>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={labelStyle}>New Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                minLength={6}
                disabled={submitting}
                style={inputStyle}
                autoFocus
              />
            </div>

            <div>
              <label style={labelStyle}>Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                required
                minLength={6}
                disabled={submitting}
                style={inputStyle}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              style={primaryBtnStyle}
              onMouseEnter={e => !submitting && primaryHoverIn(e)}
              onMouseLeave={e => !submitting && primaryHoverOut(e)}
            >
              {submitting ? 'Updating...' : 'Update Password'}
            </button>
          </form>

          {formError && (
            <div style={errorStyle}>{formError}</div>
          )}

          <div style={{ textAlign: 'center', marginTop: 4 }}>
            <button
              onClick={() => router.push('/login')}
              style={linkBtnStyle}
            >
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#0a0a0a',
  color: '#ddd',
  padding: 24,
};

const cardStyle: React.CSSProperties = {
  width: 360,
  border: '1px solid #2a2a2a',
  borderRadius: 12,
  padding: 24,
  background: 'linear-gradient(135deg, rgba(25,25,25,0.98) 0%, rgba(15,15,15,0.98) 100%)',
  boxShadow: '0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)',
};

const primaryBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: 'none',
  background: '#e6e6e6',
  color: '#0a0a0a',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
  transition: 'all 0.15s ease',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #2a2a2a',
  background: 'rgba(15,15,15,0.9)',
  color: '#e6e6e6',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s ease',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 500,
  color: '#888',
  marginBottom: 6,
};

const errorStyle: React.CSSProperties = {
  color: '#f66',
  fontSize: 12,
  textAlign: 'center',
  padding: '8px 12px',
  background: 'rgba(255,102,102,0.1)',
  borderRadius: 6,
};

const linkBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#8af',
  cursor: 'pointer',
  fontSize: 12,
  padding: 0,
  textDecoration: 'underline',
};

const primaryHoverIn = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.background = '#fff';
  e.currentTarget.style.boxShadow = '0 4px 12px rgba(255,255,255,0.15)';
};

const primaryHoverOut = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.background = '#e6e6e6';
  e.currentTarget.style.boxShadow = 'none';
};
