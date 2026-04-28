import { getRequestConfig } from 'next-intl/server';

/**
 * English-only by product policy — see WelcomeModal.tsx for the rationale.
 *
 * The next-intl framework itself stays wired up (middleware locale detection,
 * NextIntlClientProvider, useTranslations in a few components) so adding a
 * second language back is a one-import change. But while the policy is
 * "English only", we hardcode the loaded messages to en.json regardless of
 * what locale the request claims, instead of keeping a misleadingly-named
 * `messages/zh-CN.json` file whose contents are actually English.
 *
 * If multi-language ships again:
 *   1. Recreate `messages/<locale>.json` with translated content.
 *   2. Switch the `messages` line below back to a dynamic import keyed
 *      on the (validated) request locale.
 *   3. Re-add `LocaleSwitcher` to UserMenuPanel.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  // Resolve the locale for `useLocale()` / <html lang> / <Intl.*> formatters
  // — these still need a valid BCP-47 string even though we don't translate.
  const raw = await requestLocale;
  const locale = raw === 'zh-CN' ? 'zh-CN' : 'en';

  return {
    locale,
    messages: (await import('../messages/en.json')).default,
  };
});
