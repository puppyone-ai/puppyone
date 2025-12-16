'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../supabase/SupabaseAuthProvider'

export default function LoginPage() {
  const { session, signInWithProvider } = useAuth()
  const router = useRouter()
  const [loading, setLoading] = useState<'google' | 'github' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (session) {
      router.replace('/')
    }
  }, [session, router])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#0a0a0a',
      color: '#ddd',
      padding: 24
    }}>
      <div style={{
        width: 360,
        border: '1px solid #2a2a2a',
        borderRadius: 12,
        padding: 24,
        background: 'linear-gradient(135deg, rgba(25,25,25,0.98) 0%, rgba(15,15,15,0.98) 100%)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <img 
              src="/puppybase.svg" 
              alt="PuppyBase" 
              width={72} 
              height={72} 
              style={{ opacity: 0.95, display: 'block', margin: '0 auto' }} 
            />
            <div style={{ marginTop: 10, fontSize: 16, fontWeight: 500, color: '#999' }}>Sign in to PuppyBase</div>
          </div>

          <button
            onClick={async () => {
              setError(null)
              setLoading('google')
              try {
                await signInWithProvider('google')
              } catch (e: unknown) {
                const errMessage = e instanceof Error ? e.message : 'Sign-in failed'
                setError(errMessage)
              } finally {
                setLoading(null)
              }
            }}
            style={btnStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(35,35,35,0.95) 0%, rgba(25,25,25,0.95) 100%)'
              e.currentTarget.style.borderColor = '#3a3a3a'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(20,20,20,0.9)'
              e.currentTarget.style.borderColor = '#2a2a2a'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <GoogleIcon />
              <span>{loading === 'google' ? 'Redirecting…' : 'Continue with Google'}</span>
            </span>
          </button>

          <button
            onClick={async () => {
              setError(null)
              setLoading('github')
              try {
                await signInWithProvider('github')
              } catch (e: unknown) {
                const errMessage = e instanceof Error ? e.message : 'Sign-in failed'
                setError(errMessage)
              } finally {
                setLoading(null)
              }
            }}
            style={btnStyle}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(35,35,35,0.95) 0%, rgba(25,25,25,0.95) 100%)'
              e.currentTarget.style.borderColor = '#3a3a3a'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(20,20,20,0.9)'
              e.currentTarget.style.borderColor = '#2a2a2a'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <GithubIcon />
              <span>{loading === 'github' ? 'Redirecting…' : 'Continue with GitHub'}</span>
            </span>
          </button>

          {error && (
            <div style={{ color: '#f66', fontSize: 12, textAlign: 'center' }}>{error}</div>
          )}

          <div style={{ fontSize: 12, color: '#888', textAlign: 'center', marginTop: 8 }}>
            By continuing you agree to our Terms and Privacy Policy.
          </div>
        </div>
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid #2a2a2a',
  background: 'rgba(20,20,20,0.9)',
  color: '#e6e6e6',
  cursor: 'pointer',
  fontSize: 14,
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 533.5 544.3" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="#4285f4" d="M533.5 278.4c0-17.6-1.6-34.4-4.6-50.4H272v95.3h147c-6.4 34.6-25.8 63.9-55 83.6l89 69.4c51.8-47.7 80.5-118 80.5-198z"/>
      <path fill="#34a853" d="M272 544.3c74.7 0 137.5-24.8 183.3-67.4l-89-69.4c-24.7 16.6-56.3 26.3-94.3 26.3-72.5 0-134-49-155.9-114.9l-92 71.6c41.6 82.5 127.1 153.8 247.9 153.8z"/>
      <path fill="#fbbc04" d="M116.1 318.9c-10-29.8-10-62.1 0-91.9l-92-71.6C4 211 0 240.9 0 272.4s4 61.4 24.1 116.9l92-70.4z"/>
      <path fill="#ea4335" d="M272 107.7c39.7-.6 77.6 14.7 105.8 42.9l77.5-77.5C395.1 24 334.2 0 272 0 151.2 0 65.7 71.3 24.1 155.5l92 71.6C138 161.3 199.5 107.7 272 107.7z"/>
    </svg>
  )
}

function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 1C6 1 1.5 5.5 1.5 11.5c0 4.6 3 8.5 7.2 9.9.5.1.7-.2.7-.5v-1.9c-2.9.6-3.5-1.2-3.5-1.2-.5-1.2-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1 1 1.7 2.6 1.2 3.2.9.1-.7.4-1.2.7-1.5-2.4-.3-4.9-1.2-4.9-5.3 0-1.2.4-2.1 1.1-2.9-.1-.3-.5-1.4.1-2.9 0 0 .9-.3 3 .1 1-.3 2-.4 3.1-.4s2.1.1 3.1.4c2.1-1.4 3-.1 3-.1.6 1.5.2 2.6.1 2.9.7.8 1.1 1.7 1.1 2.9 0 4.1-2.6 5.1-5 5.4.4.3.7 1 .7 2v3c0 .3.2.6.7.5 4.2-1.4 7.2-5.3 7.2-9.9C22.5 5.5 18 1 12 1z"/>
    </svg>
  )
}


