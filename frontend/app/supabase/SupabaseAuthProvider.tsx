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
import {
  getEmailConfirmUrl,
  getPasswordResetRedirectUrl,
  getOAuthCallbackUrl,
} from '@/lib/auth-urls';

type AuthContextValue = {
  supabase: SupabaseClient | null;
  session: Session | null;
  userId: string | null;
  isAuthReady: boolean;
  signInWithProvider: (provider: 'google' | 'github') => Promise<void>;
  signInWithOtp: (email: string) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<{ needsEmailConfirmation: boolean }>;
  verifyEmailOtp: (email: string, token: string) => Promise<{ accessToken: string }>;
  resendConfirmation: (email: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
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

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: getOAuthCallbackUrl(),
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

  const signInWithOtp = async (email: string) => {
    if (!supabase) {
      throw new Error('Supabase is not configured');
    }
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: getEmailConfirmUrl(),
      },
    });
    if (error) {
      throw error;
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

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      throw error;
    }

    // 检查是否需要邮箱验证
    // 如果 session 为 null 且 user 存在，说明需要验证邮箱
    const needsEmailConfirmation = !data.session && !!data.user;

    return { needsEmailConfirmation };
  };

  const verifyEmailOtp = async (email: string, token: string) => {
    if (!supabase) {
      throw new Error('Supabase is not configured');
    }
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });
    if (error) {
      throw error;
    }
    if (!data.session) {
      throw new Error('Verification succeeded but no session was returned.');
    }
    return { accessToken: data.session.access_token };
  };

  const resendConfirmation = async (email: string) => {
    if (!supabase) {
      throw new Error('Supabase is not configured');
    }
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
    });
    if (error) {
      throw error;
    }
  };

  const resetPassword = async (email: string) => {
    if (!supabase) {
      throw new Error('Supabase is not configured');
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getPasswordResetRedirectUrl(),
    });

    if (error) {
      throw error;
    }
  };

  const updatePassword = async (newPassword: string) => {
    if (!supabase) {
      throw new Error('Supabase is not configured');
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
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
      signInWithOtp,
      signInWithEmail,
      signUpWithEmail,
      verifyEmailOtp,
      resendConfirmation,
      resetPassword,
      updatePassword,
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
