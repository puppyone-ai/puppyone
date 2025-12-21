'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../app/supabase/SupabaseAuthProvider'

interface AuthGuardProps {
  children: React.ReactNode
}

/**
 * 认证守卫组件
 * 
 * 包裹需要登录才能访问的页面，未登录时自动跳转到登录页
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const { session, isAuthReady } = useAuth()
  const router = useRouter()

  useEffect(() => {
    // 等待 auth 状态加载完成
    if (!isAuthReady) return

    // 如果没有 session，跳转到登录页
    if (!session) {
      router.replace('/login')
    }
  }, [session, isAuthReady, router])

  // 加载中状态
  if (!isAuthReady) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0a0a0a',
        color: '#888',
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px',
        }}>
          <div style={{
            width: '40px',
            height: '40px',
            border: '3px solid #333',
            borderTop: '3px solid #3b82f6',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          <span>Loading...</span>
        </div>
        <style jsx>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    )
  }

  // 未登录时显示空白（正在跳转）
  if (!session) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#0a0a0a',
      }} />
    )
  }

  // 已登录，显示子组件
  return <>{children}</>
}

