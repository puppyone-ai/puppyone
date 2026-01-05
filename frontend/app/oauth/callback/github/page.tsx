'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { githubCallback } from '@/lib/oauthApi';

function GithubCallbackContent() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(
    'loading'
  );
  const [message, setMessage] = useState('');
  const [username, setUsername] = useState('');
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code');

      if (!code) {
        setStatus('error');
        setMessage('Missing authorization code');
        return;
      }

      try {
        const result = await githubCallback(code);

        if (result.success) {
          setStatus('success');
          setMessage('Successfully connected to GitHub!');
          setUsername(result.username || '');
        } else {
          setStatus('error');
          setMessage(result.message || 'Failed to connect to GitHub');
        }
      } catch (error) {
        console.error('GitHub OAuth callback error:', error);
        setStatus('error');
        setMessage(
          error instanceof Error
            ? error.message
            : 'An unexpected error occurred'
        );
      }
    };

    handleCallback();
  }, [searchParams]);

  const handleContinue = () => {
    router.push('/connect');
  };

  const handleRetry = () => {
    router.push('/connect?auth=github');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          padding: '32px',
          borderRadius: '8px',
          boxShadow:
            '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
          width: '100%',
          maxWidth: '448px',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <h1
            style={{
              fontSize: '24px',
              fontWeight: 'bold',
              marginBottom: '8px',
            }}
          >
            {status === 'loading' && 'Connecting...'}
            {status === 'success' && 'Connected Successfully!'}
            {status === 'error' && 'Connection Failed'}
          </h1>
          <p style={{ color: '#6b7280', fontSize: '14px' }}>
            {status === 'loading' &&
              'Please wait while we connect your GitHub account...'}
            {status === 'success' &&
              'Your GitHub account has been successfully connected.'}
            {status === 'error' &&
              'There was an error connecting your GitHub account.'}
          </p>
        </div>

        <div style={{ marginBottom: '24px' }}>
          {status === 'loading' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '16px',
              }}
            >
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  border: '4px solid #e5e7eb',
                  borderTop: '4px solid #3b82f6',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }}
              />
              <p
                style={{
                  fontSize: '14px',
                  color: '#6b7280',
                  textAlign: 'center',
                }}
              >
                This will only take a moment...
              </p>
            </div>
          )}

          {status === 'success' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '16px',
              }}
            >
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  backgroundColor: '#10b981',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width='24' height='24' fill='white' viewBox='0 0 20 20'>
                  <path
                    fillRule='evenodd'
                    d='M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z'
                    clipRule='evenodd'
                  />
                </svg>
              </div>
              <div style={{ textAlign: 'center' }}>
                {username && (
                  <p
                    style={{
                      fontSize: '14px',
                      color: '#6b7280',
                      marginBottom: '8px',
                    }}
                  >
                    Connected as:{' '}
                    <span style={{ fontWeight: '500' }}>{username}</span>
                  </p>
                )}
                <p style={{ fontSize: '14px', color: '#6b7280' }}>{message}</p>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '16px',
              }}
            >
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  backgroundColor: '#ef4444',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width='24' height='24' fill='white' viewBox='0 0 20 20'>
                  <path
                    fillRule='evenodd'
                    d='M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z'
                    clipRule='evenodd'
                  />
                </svg>
              </div>
              <div style={{ textAlign: 'center' }}>
                <p
                  style={{
                    fontSize: '14px',
                    color: '#dc2626',
                    marginBottom: '16px',
                  }}
                >
                  {message}
                </p>
                <p
                  style={{
                    fontSize: '12px',
                    color: '#6b7280',
                  }}
                >
                  Please try again or contact support if the problem persists.
                </p>
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            paddingTop: '16px',
          }}
        >
          {status === 'success' && (
            <button
              onClick={handleContinue}
              style={{
                width: '100%',
                backgroundColor: '#3b82f6',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              Continue to Connect Page
            </button>
          )}

          {status === 'error' && (
            <button
              onClick={handleRetry}
              style={{
                width: '100%',
                backgroundColor: 'white',
                color: '#374151',
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid #d1d5db',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              Try Again
            </button>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: '16px' }}>
          <button
            onClick={() => router.push('/connect')}
            style={{
              backgroundColor: 'transparent',
              color: '#6b7280',
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Back to Connect
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GithubCallbackPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: '100vh',
            backgroundColor: '#f9fafb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ fontSize: '14px', color: '#6b7280' }}>Loading...</div>
        </div>
      }
    >
      <GithubCallbackContent />
    </Suspense>
  );
}
