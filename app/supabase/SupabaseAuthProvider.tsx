'use client'

import React, { createContext, useContext, useMemo, useState, useEffect } from 'react'
import { createClient, SupabaseClient, Session } from '@supabase/supabase-js'

type AuthContextValue = {
  supabase: SupabaseClient | null
  session: Session | null
  userId: string | null
  isAuthReady: boolean
  signInWithProvider: (provider: 'google' | 'github') => Promise<void>
  signOut: () => Promise<void>
  getAccessToken: () => Promise<string | null>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// 开发模式：通过环境变量控制，绕过 Supabase 认证
const DEV_MODE = process.env.NEXT_PUBLIC_DEV_MODE === 'true'

// 创建模拟的 session 对象用于开发模式
function createMockSession(): Session {
  return {
    access_token: 'dev-mode-mock-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'dev-mode-mock-refresh-token',
    user: {
      id: 'dev-mode-user-id',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'dev@localhost',
      email_confirmed_at: new Date().toISOString(),
      phone: '',
      confirmed_at: new Date().toISOString(),
      last_sign_in_at: new Date().toISOString(),
      app_metadata: {},
      user_metadata: {
        avatar_url: undefined,
        picture: undefined,
      },
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  } as Session
}

export function SupabaseAuthProvider({ children }: { children: React.ReactNode }) {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(false)

  useEffect(() => {
    // 开发模式：直接设置模拟 session，跳过 Supabase 初始化
    if (DEV_MODE) {
      console.log('🔧 开发模式已启用：绕过 Supabase 认证')
      setSession(createMockSession())
      setIsAuthReady(true)
      return
    }

    // 生产模式：正常使用 Supabase 认证
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anon) {
      console.warn('Supabase env not set: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY')
      // Mark auth as ready to avoid indefinite loading when misconfigured
      setIsAuthReady(true)
      return
    }
    const client = createClient(url, anon)
    setSupabase(client)

    client.auth
      .getSession()
      .then(({ data }) => setSession(data.session ?? null))
      .finally(() => setIsAuthReady(true))
    const { data: sub } = client.auth.onAuthStateChange((_event, newSession) => setSession(newSession))
    return () => sub.subscription.unsubscribe()
  }, [])

  const signInWithProvider = async (provider: 'google' | 'github') => {
    // 开发模式：直接返回成功
    if (DEV_MODE) {
      console.log('🔧 开发模式：跳过登录，已自动登录')
      return
    }
    if (!supabase) {
      console.warn('Supabase client not initialized')
      throw new Error('Supabase is not configured')
    }
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
          // ensure we redirect the browser (not popup)
          skipBrowserRedirect: false,
        }
      })
      if (error) throw error
    } catch (err) {
      console.error('OAuth sign-in failed:', err)
      throw err
    }
  }

  const signOut = async () => {
    // 开发模式：清除模拟 session
    if (DEV_MODE) {
      setSession(null)
      return
    }
    if (!supabase) return
    await supabase.auth.signOut()
  }

  const getAccessToken = async (): Promise<string | null> => {
    // 开发模式：返回模拟 token
    if (DEV_MODE) {
      return session?.access_token ?? 'dev-mode-mock-token'
    }
    if (!supabase) return null
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  }

  const value = useMemo<AuthContextValue>(() => ({
    supabase,
    session,
    userId: session?.user?.id ?? null,
    isAuthReady,
    signInWithProvider,
    signOut,
    getAccessToken
  }), [supabase, session, isAuthReady])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within SupabaseAuthProvider')
  return ctx
}


