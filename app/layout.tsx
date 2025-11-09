import type { ReactNode } from 'react';
import { SupabaseAuthProvider } from './supabase/SupabaseAuthProvider';

export const metadata = {
  title: 'PuppyBase',
  description: 'PuppyBase',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{margin: 0}}>
        <SupabaseAuthProvider>
          {children}
        </SupabaseAuthProvider>
      </body>
    </html>
  );
}


