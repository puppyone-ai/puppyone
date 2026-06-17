export interface ProviderIconSource {
  provider?: string | null;
  icon?: string | null;
  iconUrl?: string | null;
  icon_url?: string | null;
}

const KNOWN_PROVIDER_ICON_URLS: Record<string, string> = {
  gmail: '/icons/gmail.svg',
  google_calendar: '/icons/google_calendar.svg',
  google_sheets: '/icons/google_sheet.svg',
  google_docs: '/icons/google_doc.svg',
  google_drive: '/icons/google_drive.svg',
  notion: '/icons/notion.svg',
  linear: '/icons/linear.svg',
  airtable: '/icons/airtable.png',
  supabase: '/icons/supabase-icon.png',
};

const LOW_RES_GOOGLE_ICON_HINTS: ReadonlyArray<[string, string]> = [
  ['gmail_2020q4', 'gmail'],
  ['calendar_2020q4', 'google_calendar'],
  ['sheets_2020q4', 'google_sheets'],
  ['docs_2020q4', 'google_docs'],
  ['drive_2020q4', 'google_drive'],
];

export function getKnownProviderIconUrl(provider?: string | null): string | null {
  const normalized = provider?.trim();
  if (!normalized) return null;
  return KNOWN_PROVIDER_ICON_URLS[normalized] ?? null;
}

export function resolveProviderIconUrl(source: ProviderIconSource): string | null {
  const explicitIcon = normalizeProviderIconSource(source.icon);
  if (explicitIcon) return explicitIcon;

  const providerIcon = getKnownProviderIconUrl(source.provider);
  if (providerIcon) return providerIcon;

  return normalizeProviderIconSource(source.iconUrl ?? source.icon_url);
}

export function normalizeProviderIconSource(source?: string | null): string | null {
  const normalized = source?.trim();
  if (!normalized) return null;

  const knownProviderIcon = getKnownProviderIconUrl(normalized);
  if (knownProviderIcon) return knownProviderIcon;

  for (const [hint, provider] of LOW_RES_GOOGLE_ICON_HINTS) {
    if (normalized.includes(hint)) return KNOWN_PROVIDER_ICON_URLS[provider] ?? null;
  }

  if (
    normalized.startsWith('/') ||
    normalized.startsWith('http://') ||
    normalized.startsWith('https://')
  ) {
    return normalized;
  }

  return null;
}
