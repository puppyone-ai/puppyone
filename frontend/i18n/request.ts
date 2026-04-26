import { getRequestConfig } from 'next-intl/server';

const LOCALES = ['en', 'zh-CN'] as const;
type Locale = (typeof LOCALES)[number];

function isValidLocale(v: string | undefined): v is Locale {
  return LOCALES.includes(v as Locale);
}

export default getRequestConfig(async ({ requestLocale }) => {
  const raw = await requestLocale;
  const locale: Locale = isValidLocale(raw) ? raw : 'en';
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
