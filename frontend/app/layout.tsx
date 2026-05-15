import './globals.css';
import type { ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { SupabaseAuthProvider } from './supabase/SupabaseAuthProvider';
import { BackgroundTaskNotifier } from '../components/BackgroundTaskNotifier';
import { SWRGlobalProvider } from './SWRProvider';
import { ThemeProvider } from '../components/theme/ThemeProvider';

export const metadata = {
  title: 'puppyone | Context base for AI agents',
  description: 'Context base for AI agents',
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={GeistSans.variable}
    >
      <head />
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            <SWRGlobalProvider>
              <SupabaseAuthProvider>
                {children}
                <BackgroundTaskNotifier />
              </SupabaseAuthProvider>
            </SWRGlobalProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
