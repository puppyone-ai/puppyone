'use client';

import React, { useState } from 'react';
import { useAuth } from '../supabase/SupabaseAuthProvider';
import { useRouter } from 'next/navigation';

type AuthMode = 'signin' | 'signup' | 'forgot';

/**
 * 登录页面
 *
 * 支持：
 * - Google OAuth
 * - GitHub OAuth
 * - 邮箱/密码 登录/注册
 * - 忘记密码
 */
export default function LoginPage() {
  const router = useRouter();
  const { signInWithProvider, signInWithEmail, signUpWithEmail, resetPassword } = useAuth();
  
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState<'google' | 'github' | 'email' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleOAuthSignIn = async (provider: 'google' | 'github') => {
    setError(null);
    setMessage(null);
    setLoading(provider);
    try {
      await signInWithProvider(provider);
    } catch (e: unknown) {
      const errMessage = e instanceof Error ? e.message : 'Sign-in failed';
      setError(errMessage);
    } finally {
      setLoading(null);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading('email');

    try {
      if (mode === 'signin') {
        await signInWithEmail(email, password);
        // 登录成功后会自动触发 session 变化，middleware 会处理重定向
        router.push('/home');
      } else if (mode === 'signup') {
        const result = await signUpWithEmail(email, password);
        if (result.needsEmailConfirmation) {
          setMessage('Check your email for the confirmation link.');
          setEmail('');
          setPassword('');
        } else {
          // 如果不需要验证（Supabase 设置为自动确认），直接跳转
          router.push('/home');
        }
      } else if (mode === 'forgot') {
        await resetPassword(email);
        setMessage('Check your email for the password reset link.');
        setEmail('');
      }
    } catch (e: unknown) {
      const errMessage = e instanceof Error ? e.message : 'Operation failed';
      setError(errMessage);
    } finally {
      setLoading(null);
    }
  };

  const getSubmitButtonText = () => {
    if (loading === 'email') return 'Please wait...';
    switch (mode) {
      case 'signin': return 'Sign In';
      case 'signup': return 'Create Account';
      case 'forgot': return 'Send Reset Link';
    }
  };

  const getTitle = () => {
    switch (mode) {
      case 'signin': return 'Sign in to PuppyBase';
      case 'signup': return 'Create your account';
      case 'forgot': return 'Reset your password';
    }
  };

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Logo & Title */}
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <img
              src='/puppybase.svg'
              alt='PuppyBase'
              width={64}
              height={64}
              style={{ opacity: 0.95, display: 'block', margin: '0 auto' }}
            />
            <div style={{ marginTop: 10, fontSize: 16, fontWeight: 500, color: '#999' }}>
              {getTitle()}
            </div>
          </div>

          {/* OAuth Buttons - 只在登录和注册模式显示 */}
          {mode !== 'forgot' && (
            <>
              <button
                onClick={() => handleOAuthSignIn('google')}
                disabled={loading !== null}
                style={btnStyle}
                onMouseEnter={e => !loading && hoverIn(e)}
                onMouseLeave={e => !loading && hoverOut(e)}
              >
                <span style={btnContentStyle}>
                  <GoogleIcon />
                  <span>{loading === 'google' ? 'Redirecting...' : 'Continue with Google'}</span>
                </span>
              </button>

              <button
                onClick={() => handleOAuthSignIn('github')}
                disabled={loading !== null}
                style={btnStyle}
                onMouseEnter={e => !loading && hoverIn(e)}
                onMouseLeave={e => !loading && hoverOut(e)}
              >
                <span style={btnContentStyle}>
                  <GithubIcon />
                  <span>{loading === 'github' ? 'Redirecting...' : 'Continue with GitHub'}</span>
                </span>
              </button>

              {/* Divider */}
              <div style={dividerStyle}>
                <div style={dividerLineStyle} />
                <span style={dividerTextStyle}>or</span>
                <div style={dividerLineStyle} />
              </div>
            </>
          )}

          {/* Email Form */}
          <form onSubmit={handleEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                disabled={loading !== null}
                style={inputStyle}
              />
            </div>

            {mode !== 'forgot' && (
              <div>
                <label style={labelStyle}>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  disabled={loading !== null}
                  style={inputStyle}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading !== null}
              style={primaryBtnStyle}
              onMouseEnter={e => !loading && primaryHoverIn(e)}
              onMouseLeave={e => !loading && primaryHoverOut(e)}
            >
              {getSubmitButtonText()}
            </button>
          </form>

          {/* Error Message */}
          {error && (
            <div style={errorStyle}>{error}</div>
          )}

          {/* Success Message */}
          {message && (
            <div style={successStyle}>{message}</div>
          )}

          {/* Mode Switch Links */}
          <div style={linksContainerStyle}>
            {mode === 'signin' && (
              <>
                <span style={linkTextStyle}>
                  Don't have an account?{' '}
                  <button onClick={() => { setMode('signup'); setError(null); setMessage(null); }} style={linkBtnStyle}>
                    Sign up
                  </button>
                </span>
                <button onClick={() => { setMode('forgot'); setError(null); setMessage(null); }} style={linkBtnStyle}>
                  Forgot password?
                </button>
              </>
            )}
            {mode === 'signup' && (
              <span style={linkTextStyle}>
                Already have an account?{' '}
                <button onClick={() => { setMode('signin'); setError(null); setMessage(null); }} style={linkBtnStyle}>
                  Sign in
                </button>
              </span>
            )}
            {mode === 'forgot' && (
              <button onClick={() => { setMode('signin'); setError(null); setMessage(null); }} style={linkBtnStyle}>
                Back to sign in
              </button>
            )}
          </div>

          {/* Terms */}
          <div style={termsStyle}>
            By continuing you agree to our Terms and Privacy Policy.
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Styles
// ============================================

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

const btnStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #2a2a2a',
  background: 'rgba(20,20,20,0.9)',
  color: '#e6e6e6',
  cursor: 'pointer',
  fontSize: 14,
  transition: 'all 0.15s ease',
};

const btnContentStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
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

const dividerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  margin: '8px 0',
};

const dividerLineStyle: React.CSSProperties = {
  flex: 1,
  height: 1,
  background: '#2a2a2a',
};

const dividerTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#666',
};

const errorStyle: React.CSSProperties = {
  color: '#f66',
  fontSize: 12,
  textAlign: 'center',
  padding: '8px 12px',
  background: 'rgba(255,102,102,0.1)',
  borderRadius: 6,
};

const successStyle: React.CSSProperties = {
  color: '#6f6',
  fontSize: 12,
  textAlign: 'center',
  padding: '8px 12px',
  background: 'rgba(102,255,102,0.1)',
  borderRadius: 6,
};

const linksContainerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  marginTop: 4,
};

const linkTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#888',
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

const termsStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#666',
  textAlign: 'center',
  marginTop: 8,
};

// Hover handlers
const hoverIn = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.background = 'linear-gradient(135deg, rgba(35,35,35,0.95) 0%, rgba(25,25,25,0.95) 100%)';
  e.currentTarget.style.borderColor = '#3a3a3a';
};

const hoverOut = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.background = 'rgba(20,20,20,0.9)';
  e.currentTarget.style.borderColor = '#2a2a2a';
};

const primaryHoverIn = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.background = '#fff';
  e.currentTarget.style.boxShadow = '0 4px 12px rgba(255,255,255,0.15)';
};

const primaryHoverOut = (e: React.MouseEvent<HTMLButtonElement>) => {
  e.currentTarget.style.background = '#e6e6e6';
  e.currentTarget.style.boxShadow = 'none';
};

// ============================================
// Icons
// ============================================

function GoogleIcon() {
  return (
    <svg width='16' height='16' viewBox='0 0 533.5 544.3' xmlns='http://www.w3.org/2000/svg' aria-hidden='true'>
      <path fill='#4285f4' d='M533.5 278.4c0-17.6-1.6-34.4-4.6-50.4H272v95.3h147c-6.4 34.6-25.8 63.9-55 83.6l89 69.4c51.8-47.7 80.5-118 80.5-198z'/>
      <path fill='#34a853' d='M272 544.3c74.7 0 137.5-24.8 183.3-67.4l-89-69.4c-24.7 16.6-56.3 26.3-94.3 26.3-72.5 0-134-49-155.9-114.9l-92 71.6c41.6 82.5 127.1 153.8 247.9 153.8z'/>
      <path fill='#fbbc04' d='M116.1 318.9c-10-29.8-10-62.1 0-91.9l-92-71.6C4 211 0 240.9 0 272.4s4 61.4 24.1 116.9l92-70.4z'/>
      <path fill='#ea4335' d='M272 107.7c39.7-.6 77.6 14.7 105.8 42.9l77.5-77.5C395.1 24 334.2 0 272 0 151.2 0 65.7 71.3 24.1 155.5l92 71.6C138 161.3 199.5 107.7 272 107.7z'/>
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg width='16' height='16' viewBox='0 0 24 24' aria-hidden='true' fill='currentColor'>
      <path d='M12 1C6 1 1.5 5.5 1.5 11.5c0 4.6 3 8.5 7.2 9.9.5.1.7-.2.7-.5v-1.9c-2.9.6-3.5-1.2-3.5-1.2-.5-1.2-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1 1 1.7 2.6 1.2 3.2.9.1-.7.4-1.2.7-1.5-2.4-.3-4.9-1.2-4.9-5.3 0-1.2.4-2.1 1.1-2.9-.1-.3-.5-1.4.1-2.9 0 0 .9-.3 3 .1 1-.3 2-.4 3.1-.4s2.1.1 3.1.4c2.1-1.4 3-.1 3-.1.6 1.5.2 2.6.1 2.9.7.8 1.1 1.7 1.1 2.9 0 4.1-2.6 5.1-5 5.4.4.3.7 1 .7 2v3c0 .3.2.6.7.5 4.2-1.4 7.2-5.3 7.2-9.9C22.5 5.5 18 1 12 1z' />
    </svg>
  );
}
