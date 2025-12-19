import type { ReactNode } from 'react';
import { SupabaseAuthProvider } from './supabase/SupabaseAuthProvider';
import { BackgroundTaskNotifier } from '../components/BackgroundTaskNotifier';

export const metadata = {
  title: 'PuppyBase',
  description: 'PuppyBase',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body style={{margin: 0}}>
        <SupabaseAuthProvider>
          {children}
          <BackgroundTaskNotifier />
        </SupabaseAuthProvider>
      </body>
    </html>
  );
}


