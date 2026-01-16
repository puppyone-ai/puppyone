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
        {/* 关键：提前预取 Next 生成的全局 CSS，避免首屏短暂无样式（FOUC） */}
        <link rel='preload' as='style' href='/_next/static/css/app/layout.css' />
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
