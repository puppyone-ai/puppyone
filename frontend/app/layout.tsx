import './globals.css';
import type { ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { JetBrains_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { SupabaseAuthProvider } from './supabase/SupabaseAuthProvider';
import { BackgroundTaskNotifier } from '../components/BackgroundTaskNotifier';
import { SWRGlobalProvider } from './SWRProvider';

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  preload: false,
});

export const metadata = {
  title: 'puppyone | Context base for AI agents',
  description: 'Context base for AI agents',
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable} ${jetbrainsMono.variable}`}>
      <head />
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <SWRGlobalProvider>
            <SupabaseAuthProvider>
              {children}
              <BackgroundTaskNotifier />
            </SupabaseAuthProvider>
          </SWRGlobalProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
