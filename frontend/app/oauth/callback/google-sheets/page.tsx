'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { googleSheetsCallback } from '@/lib/oauthApi'

export default function GoogleSheetsCallbackPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState<string>('')

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code')
      const error = searchParams.get('error')

      if (error) {
        setStatus('error')
        setMessage(`Authorization failed: ${error}`)
        setTimeout(() => {
          router.push('/settings/connect')
        }, 3000)
        return
      }

      if (!code) {
        setStatus('error')
        setMessage('No authorization code received')
        setTimeout(() => {
          router.push('/settings/connect')
        }, 3000)
        return
      }

      try {
        const result = await googleSheetsCallback(code)
        
        if (result.success) {
          setStatus('success')
          setMessage(result.message || 'Successfully connected to Google Sheets!')
          setTimeout(() => {
            router.push('/settings/connect')
          }, 2000)
        } else {
          setStatus('error')
          setMessage(result.message || 'Failed to connect to Google Sheets')
          setTimeout(() => {
            router.push('/settings/connect')
          }, 3000)
        }
      } catch (err) {
        setStatus('error')
        setMessage(err instanceof Error ? err.message : 'An unexpected error occurred')
        setTimeout(() => {
          router.push('/settings/connect')
        }, 3000)
      }
    }

    handleCallback()
  }, [searchParams, router])

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#0a0a0a',
      color: '#CDCDCD',
    }}>
      <div style={{
        textAlign: 'center',
        maxWidth: 400,
        padding: 32,
      }}>
        {status === 'loading' && (
          <>
            <div style={{
              fontSize: 16,
              fontWeight: 500,
              marginBottom: 16,
            }}>
              Connecting to Google Sheets...
            </div>
            <div style={{
              fontSize: 13,
              color: '#8B8B8B',
            }}>
              Please wait while we complete the authorization
            </div>
          </>
        )}
        
        {status === 'success' && (
          <>
            <div style={{
              fontSize: 40,
              marginBottom: 16,
            }}>
              ✓
            </div>
            <div style={{
              fontSize: 16,
              fontWeight: 500,
              marginBottom: 8,
              color: '#22c55e',
            }}>
              Success!
            </div>
            <div style={{
              fontSize: 13,
              color: '#8B8B8B',
            }}>
              {message}
            </div>
            <div style={{
              fontSize: 12,
              color: '#666',
              marginTop: 16,
            }}>
              Redirecting back to Connect...
            </div>
          </>
        )}
        
        {status === 'error' && (
          <>
            <div style={{
              fontSize: 40,
              marginBottom: 16,
            }}>
              ✗
            </div>
            <div style={{
              fontSize: 16,
              fontWeight: 500,
              marginBottom: 8,
              color: '#ef4444',
            }}>
              Connection Failed
            </div>
            <div style={{
              fontSize: 13,
              color: '#8B8B8B',
            }}>
              {message}
            </div>
            <div style={{
              fontSize: 12,
              color: '#666',
              marginTop: 16,
            }}>
              Redirecting back to Connect...
            </div>
          </>
        )}
      </div>
    </div>
  )
}

