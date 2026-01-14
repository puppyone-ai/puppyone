import './globals.css';
import type { ReactNode } from 'react';
import { SupabaseAuthProvider } from './supabase/SupabaseAuthProvider';
import { BackgroundTaskNotifier } from '../components/BackgroundTaskNotifier';
import { TaskStatusWidget } from '../components/TaskStatusWidget';

export const metadata = {
  title: 'puppyone | Context base for AI agents',
  description: 'Context base for AI agents',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='zh-CN'>
      <head>
        <link rel='preconnect' href='https://fonts.googleapis.com' />
        <link
          rel='preconnect'
          href='https://fonts.gstatic.com'
          crossOrigin='anonymous'
        />
        <link
          href='https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap'
          rel='stylesheet'
        />
        <style>{`
          html, body {
            height: 100%;
            width: 100%;
            margin: 0;
            padding: 0;
            overflow: hidden;
          }
          #__next {
            height: 100%;
          }
        `}</style>
      </head>
      <body>
        <SupabaseAuthProvider>
          {children}
          <BackgroundTaskNotifier />
          <TaskStatusWidget />
        </SupabaseAuthProvider>
      </body>
    </html>
  );
}
