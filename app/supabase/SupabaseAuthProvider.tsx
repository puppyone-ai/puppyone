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

export function SupabaseAuthProvider({ children }: { children: React.ReactNode }) {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isAuthReady, setIsAuthReady] = useState(false)

  useEffect(() => {
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
    if (!supabase) return
    await supabase.auth.signOut()
  }

  const getAccessToken = async (): Promise<string | null> => {
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


