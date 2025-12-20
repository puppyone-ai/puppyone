'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Supabase OAuth Callback 页面
 * 
 * Supabase 会自动处理 OAuth 回调并设置 session，
 * 这个页面只需要等待 auth 状态更新后跳转到首页。
 */
export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    // Supabase 客户端会自动从 URL 中提取 tokens 并设置 session
    // 我们只需要等待一小段时间让 auth state 更新，然后跳转
    const timer = setTimeout(() => {
      router.replace('/')
    }, 500)

    return () => clearTimeout(timer)
  }, [router])

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#0a0a0a',
      color: '#ddd',
    }}>
      <div style={{
        width: '48px',
        height: '48px',
        border: '3px solid #333',
        borderTop: '3px solid #3b82f6',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
      }} />
      <p style={{ marginTop: '16px', color: '#888' }}>
        Signing you in...
      </p>
      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

