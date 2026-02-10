'use client';

import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
} from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Session, SupabaseClient } from '@supabase/supabase-js';

type AuthContextValue = {
  supabase: SupabaseClient | null;
  session: Session | null;
  userId: string | null;
  isAuthReady: boolean;
  signInWithProvider: (provider: 'google' | 'github') => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<{ needsEmailConfirmation: boolean }>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function SupabaseAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anon) {
      console.warn(
        'Supabase env not set: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY'
      );
      setIsAuthReady(true);
      return;
    }

    const client = createBrowserClient(url, anon);
    setSupabase(client);

    // 获取当前 session
    client.auth
      .getSession()
      .then(({ data }) => setSession(data.session ?? null))
      .finally(() => setIsAuthReady(true));

    // 监听 auth 状态变化
    const { data: sub } = client.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
      }
    );

    return () => sub.subscription.unsubscribe();
  }, []);

  const signInWithProvider = async (provider: 'google' | 'github') => {
    if (!supabase) {
      console.warn('Supabase client not initialized');
      throw new Error('Supabase is not configured');
    }
    try {
      console.log('Starting OAuth sign-in with:', provider);

      // ✅ 极致精简：只信任环境变量，本地默认 localhost:3000
      // 生产环境必须配置 NEXT_PUBLIC_SITE_URL
      const siteUrl =
        process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      const redirectTo = `${siteUrl}/auth/callback`;

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: false,
        },
      });
      if (error) {
        console.error('Supabase OAuth error:', error);
        throw error;
      }
      console.log('OAuth initiated:', data);
    } catch (err) {
      console.error('OAuth sign-in failed:', err);
      throw err;
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    if (!supabase) {
      throw new Error('Supabase is not configured');
    }
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      throw error;
    }
  };

  const signUpWithEmail = async (email: string, password: string) => {
    if (!supabase) {
      throw new Error('Supabase is not configured');
    }
    
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback`,
      },
    });
    
    if (error) {
      throw error;
    }
    
    // 检查是否需要邮箱验证
    // 如果 session 为 null 且 user 存在，说明需要验证邮箱
    const needsEmailConfirmation = !data.session && !!data.user;
    
    return { needsEmailConfirmation };
  };

  const resetPassword = async (email: string) => {
    if (!supabase) {
      throw new Error('Supabase is not configured');
    }
    
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/auth/callback?type=recovery`,
    });
    
    if (error) {
      throw error;
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  const getAccessToken = async (): Promise<string | null> => {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      supabase,
      session,
      userId: session?.user?.id ?? null,
      isAuthReady,
      signInWithProvider,
      signInWithEmail,
      signUpWithEmail,
      resetPassword,
      signOut,
      getAccessToken,
    }),
    [supabase, session, isAuthReady]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within SupabaseAuthProvider');
  return ctx;
}
