export const TYPOGRAPHY_PREFERENCE_VERSION = 11 as const;

export type TypographyRole = "ui" | "content" | "code" | "terminal";
export type TypographyScale = "small" | "medium" | "large";
export type FontSourceKind = "bundled" | "system" | "imported";
export type FontCategory = "sans" | "serif" | "monospace";

export type ContentFontPreference =
  | Readonly<{ mode: "follow-theme" }>
  | Readonly<{ mode: "explicit"; fontId: string }>;

export type FontCatalogEntry = Readonly<{
  id: string;
  label: string;
  description: string;
  /** Trusted primary family expression. Locale and Emoji fallbacks are product-owned. */
  family: string;
  category: FontCategory;
  source: FontSourceKind;
  roles: readonly TypographyRole[];
}>;

export type TypographyPreferences = Readonly<{
  version: typeof TYPOGRAPHY_PREFERENCE_VERSION;
  contentFont: ContentFontPreference;
  codeFontId: string;
  terminalFontId: string;
  scale: TypographyScale;
}>;

export type ResolvedContentFontDecision = Readonly<{
  requestedValue: ContentFontPreference;
  effectiveFontId: string | null;
  source: "theme" | "user" | "fallback";
}>;

export type ResolvedTypography = Readonly<{
  ui: FontCatalogEntry;
  content: FontCatalogEntry;
  editorContentOverride: FontCatalogEntry | null;
  editorContentDecision: ResolvedContentFontDecision;
  code: FontCatalogEntry;
  terminal: FontCatalogEntry;
  scale: TypographyScale;
}>;

export const TYPOGRAPHY_SCALE_OPTIONS = Object.freeze([
  "small",
  "medium",
  "large",
] as const satisfies readonly TypographyScale[]);

export const TYPOGRAPHY_PRODUCT_DEFAULT_SCALE: TypographyScale = "medium";

export const TYPOGRAPHY_SCALE_METRICS = Object.freeze({
  small: Object.freeze({
    geometry: Object.freeze({
      controlSize: 30,
    }),
    ui: Object.freeze({
      glyph: 8,
      micro: 10,
      caption: 11,
      hint: 12,
      meta: 12,
      label: 13,
      control: 13,
      body: 13,
      bodyLarge: 14,
      sectionTitle: 15,
      title: 16,
      heading: 18,
      pageTitle: 20,
      display: 24,
      hero: 28,
    }),
    leftSidebar: Object.freeze({
      content: 13,
      meta: 11,
      lineHeight: 18,
    }),
    header: Object.freeze({
      content: 14,
      lineHeight: 19,
      meta: 12,
      metaLineHeight: 17,
    }),
    editor: Object.freeze({
      content: 14,
      lineHeight: 23,
      data: 12,
      code: 12,
      heading1: 28,
      heading2: 22,
      heading3: 18,
      heading4: 16,
      heading5: 15,
      heading6: 14,
    }),
    rightSidebar: Object.freeze({
      content: 13,
      controlLineHeight: 18,
      meta: 12,
      metaLineHeight: 18,
      caption: 11,
      captionLineHeight: 16,
      micro: 10,
      microLineHeight: 14,
      code: 12,
      terminal: 12,
      heading1: 19,
      heading2: 15,
    }),
  }),
  medium: Object.freeze({
    geometry: Object.freeze({
      controlSize: 32,
    }),
    ui: Object.freeze({
      glyph: 8,
      micro: 11,
      caption: 12,
      hint: 13,
      meta: 13,
      label: 14,
      control: 14,
      body: 14,
      bodyLarge: 15,
      sectionTitle: 16,
      title: 17,
      heading: 19,
      pageTitle: 21,
      display: 25,
      hero: 29,
    }),
    leftSidebar: Object.freeze({
      content: 14,
      meta: 12,
      lineHeight: 19,
    }),
    header: Object.freeze({
      content: 15,
      lineHeight: 20,
      meta: 13,
      metaLineHeight: 18,
    }),
    editor: Object.freeze({
      content: 15,
      lineHeight: 24,
      data: 13,
      code: 13,
      heading1: 30,
      heading2: 23,
      heading3: 19,
      heading4: 17,
      heading5: 16,
      heading6: 15,
    }),
    rightSidebar: Object.freeze({
      content: 14,
      controlLineHeight: 19,
      meta: 13,
      metaLineHeight: 19,
      caption: 12,
      captionLineHeight: 17,
      micro: 11,
      microLineHeight: 15,
      code: 13,
      terminal: 13,
      heading1: 20,
      heading2: 16,
    }),
  }),
  large: Object.freeze({
    geometry: Object.freeze({
      controlSize: 34,
    }),
    ui: Object.freeze({
      glyph: 8,
      micro: 12,
      caption: 13,
      hint: 14,
      meta: 14,
      label: 16,
      control: 16,
      body: 16,
      bodyLarge: 16,
      sectionTitle: 18,
      title: 19,
      heading: 21,
      pageTitle: 23,
      display: 27,
      hero: 31,
    }),
    leftSidebar: Object.freeze({
      content: 16,
      meta: 14,
      lineHeight: 21,
    }),
    header: Object.freeze({
      content: 16,
      lineHeight: 21,
      meta: 14,
      metaLineHeight: 19,
    }),
    editor: Object.freeze({
      content: 16,
      lineHeight: 26,
      data: 14,
      code: 14,
      heading1: 32,
      heading2: 24,
      heading3: 20,
      heading4: 18,
      heading5: 17,
      heading6: 16,
    }),
    rightSidebar: Object.freeze({
      content: 16,
      controlLineHeight: 21,
      meta: 14,
      metaLineHeight: 20,
      caption: 13,
      captionLineHeight: 18,
      micro: 12,
      microLineHeight: 16,
      code: 14,
      terminal: 14,
      heading1: 23,
      heading2: 18,
    }),
  }),
} as const satisfies Readonly<Record<TypographyScale, Readonly<{
  geometry: Readonly<{
    controlSize: number;
  }>;
  ui: Readonly<{
    glyph: number;
    micro: number;
    caption: number;
    hint: number;
    meta: number;
    label: number;
    control: number;
    body: number;
    bodyLarge: number;
    sectionTitle: number;
    title: number;
    heading: number;
    pageTitle: number;
    display: number;
    hero: number;
  }>;
  leftSidebar: Readonly<{
    content: number;
    meta: number;
    lineHeight: number;
  }>;
  header: Readonly<{
    content: number;
    lineHeight: number;
    meta: number;
    metaLineHeight: number;
  }>;
  editor: Readonly<{
    content: number;
    lineHeight: number;
    data: number;
    code: number;
    heading1: number;
    heading2: number;
    heading3: number;
    heading4: number;
    heading5: number;
    heading6: number;
  }>;
  rightSidebar: Readonly<{
    content: number;
    controlLineHeight: number;
    meta: number;
    metaLineHeight: number;
    caption: number;
    captionLineHeight: number;
    micro: number;
    microLineHeight: number;
    code: number;
    terminal: number;
    heading1: number;
    heading2: number;
  }>;
}>>>);

export const BUILTIN_FONT_IDS = {
  geistSans: "builtin:geist-sans",
  geistMono: "builtin:geist-mono",
  systemSans: "builtin:system-sans",
  systemSerif: "builtin:system-serif",
  terminalSystemMono: "builtin:terminal-system-mono",
} as const;

export const BUILTIN_FONT_CATALOG = [
  {
    id: BUILTIN_FONT_IDS.geistSans,
    label: "Geist",
    description: "PuppyOne's balanced default reading font.",
    family: "\"Geist Sans\"",
    category: "sans",
    source: "bundled",
    roles: ["ui", "content"],
  },
  {
    id: BUILTIN_FONT_IDS.systemSans,
    label: "System",
    description: "Use the native sans-serif font from this device.",
    family: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\"",
    category: "sans",
    source: "system",
    roles: ["ui", "content"],
  },
  {
    id: BUILTIN_FONT_IDS.systemSerif,
    label: "Serif",
    description: "A quiet system serif stack for long-form reading.",
    family: "ui-serif, \"New York\", \"Iowan Old Style\", \"Palatino Linotype\", Palatino, Georgia",
    category: "serif",
    source: "system",
    roles: ["content"],
  },
  {
    id: BUILTIN_FONT_IDS.geistMono,
    label: "Geist Mono",
    description: "PuppyOne's metric-stable code font.",
    family: "\"Geist Mono\"",
    category: "monospace",
    source: "bundled",
    roles: ["code"],
  },
  {
    id: BUILTIN_FONT_IDS.terminalSystemMono,
    label: "Terminal Mono",
    description: "The metric-stable native terminal stack.",
    family: "\"SF Mono\", \"SFMono-Regular\", Menlo, Monaco, Consolas, \"Liberation Mono\"",
    category: "monospace",
    source: "system",
    roles: ["terminal"],
  },
] as const satisfies readonly FontCatalogEntry[];

export const DEFAULT_TYPOGRAPHY_PREFERENCES: TypographyPreferences = Object.freeze({
  version: TYPOGRAPHY_PREFERENCE_VERSION,
  contentFont: Object.freeze({ mode: "follow-theme" }),
  codeFontId: BUILTIN_FONT_IDS.geistMono,
  terminalFontId: BUILTIN_FONT_IDS.terminalSystemMono,
  scale: TYPOGRAPHY_PRODUCT_DEFAULT_SCALE,
});

type TypographyPreferenceRole = Exclude<TypographyRole, "ui">;

const DEFAULT_FONT_ID_BY_ROLE: Readonly<Record<TypographyPreferenceRole, string>> = {
  content: BUILTIN_FONT_IDS.geistSans,
  code: DEFAULT_TYPOGRAPHY_PREFERENCES.codeFontId,
  terminal: DEFAULT_TYPOGRAPHY_PREFERENCES.terminalFontId,
};

const PRODUCT_FONT_ID_BY_ROLE: Readonly<Record<TypographyRole, string>> = {
  ui: BUILTIN_FONT_IDS.geistSans,
  content: BUILTIN_FONT_IDS.geistSans,
  code: BUILTIN_FONT_IDS.geistMono,
  terminal: BUILTIN_FONT_IDS.terminalSystemMono,
};

const FONT_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function getFontCatalogEntries(
  role: TypographyRole,
  catalog: readonly FontCatalogEntry[] = BUILTIN_FONT_CATALOG,
) {
  return catalog.filter((entry) => entry.roles.includes(role));
}

export function isValidFontCatalogEntry(value: unknown): value is FontCatalogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<FontCatalogEntry>;
  return typeof entry.id === "string"
    && FONT_ID_PATTERN.test(entry.id)
    && typeof entry.label === "string"
    && entry.label.trim().length > 0
    && typeof entry.description === "string"
    && typeof entry.family === "string"
    && entry.family.trim().length > 0
    && entry.family.length <= 1024
    && !/[\u0000-\u001f\u007f;{}]/.test(entry.family)
    && !/(?:url|var|env|attr|calc)\s*\(/i.test(entry.family)
    && (entry.category === "sans" || entry.category === "serif" || entry.category === "monospace")
    && (entry.source === "bundled" || entry.source === "system" || entry.source === "imported")
    && Array.isArray(entry.roles)
    && entry.roles.length > 0
    && entry.roles.every((role) => (
      role === "ui" || role === "content" || role === "code" || role === "terminal"
    ));
}

/** Builds a preview/isolated family without duplicating locale fallback lists in TS. */
export function createCatalogFontFamily(entry: FontCatalogEntry) {
  const localeToken = entry.category === "monospace"
    ? "--po-font-locale-mono"
    : `--po-font-locale-${entry.category}`;
  const generic = entry.category === "monospace"
    ? "monospace"
    : entry.category === "sans"
      ? "sans-serif"
      : "serif";
  return `${entry.family}, var(${localeToken}), var(--po-font-emoji), ${generic}`;
}

export function parseTypographyPreferences(value: string | null | undefined): TypographyPreferences {
  if (!value) return DEFAULT_TYPOGRAPHY_PREFERENCES;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_TYPOGRAPHY_PREFERENCES;
    const contentFont = parseContentFontPreference(parsed);
    return Object.freeze({
      version: TYPOGRAPHY_PREFERENCE_VERSION,
      contentFont,
      codeFontId: normalizeFontId(parsed.codeFontId, "code"),
      terminalFontId: normalizeFontId(parsed.terminalFontId, "terminal"),
      scale: parseTypographyScale(parsed),
    });
  } catch {
    return DEFAULT_TYPOGRAPHY_PREFERENCES;
  }
}

export function resolveTypography(
  preferences: TypographyPreferences,
  catalog: readonly FontCatalogEntry[] = BUILTIN_FONT_CATALOG,
): ResolvedTypography {
  const contentDecision = resolveContentFontPreference(preferences.contentFont, catalog);
  return Object.freeze({
    ui: resolveFontForRole(PRODUCT_FONT_ID_BY_ROLE.ui, "ui", catalog),
    content: resolveFontForRole(PRODUCT_FONT_ID_BY_ROLE.content, "content", catalog),
    editorContentOverride: contentDecision.override,
    editorContentDecision: contentDecision.decision,
    code: resolveFontForRole(preferences.codeFontId, "code", catalog),
    terminal: resolveFontForRole(preferences.terminalFontId, "terminal", catalog),
    scale: preferences.scale,
  });
}

export function withTypographyFont(
  preferences: TypographyPreferences,
  role: TypographyPreferenceRole,
  fontId: string,
): TypographyPreferences {
  const normalizedId = normalizeFontId(fontId, role);
  return Object.freeze({
    ...preferences,
    version: TYPOGRAPHY_PREFERENCE_VERSION,
    ...(role === "content"
      ? { contentFont: Object.freeze({ mode: "explicit" as const, fontId: normalizedId }) }
      : {}),
    ...(role === "code" ? { codeFontId: normalizedId } : {}),
    ...(role === "terminal" ? { terminalFontId: normalizedId } : {}),
  });
}

export function followThemeContentFont(
  preferences: TypographyPreferences,
): TypographyPreferences {
  return Object.freeze({
    ...preferences,
    version: TYPOGRAPHY_PREFERENCE_VERSION,
    contentFont: Object.freeze({ mode: "follow-theme" }),
  });
}

export function withTypographyScale(
  preferences: TypographyPreferences,
  scale: TypographyScale,
): TypographyPreferences {
  return Object.freeze({
    ...preferences,
    version: TYPOGRAPHY_PREFERENCE_VERSION,
    scale: normalizeTypographyScale(scale),
  });
}

export function isFollowingThemeContentFont(preferences: TypographyPreferences): boolean {
  return preferences.contentFont.mode === "follow-theme";
}

function resolveFontForRole(
  requestedId: string,
  role: TypographyRole,
  catalog: readonly FontCatalogEntry[],
) {
  const requested = catalog.find((entry) => entry.id === requestedId && entry.roles.includes(role));
  if (requested) return requested;

  const fallbackId = PRODUCT_FONT_ID_BY_ROLE[role];
  const fallback = catalog.find((entry) => entry.id === fallbackId && entry.roles.includes(role));
  if (fallback) return fallback;

  const firstCompatible = catalog.find((entry) => entry.roles.includes(role));
  if (firstCompatible) return firstCompatible;
  throw new Error(`Font catalog has no ${role} font.`);
}

function resolveContentFontPreference(
  preference: ContentFontPreference,
  catalog: readonly FontCatalogEntry[],
): Readonly<{
  override: FontCatalogEntry | null;
  decision: ResolvedContentFontDecision;
}> {
  if (preference.mode === "follow-theme") {
    return Object.freeze({
      override: null,
      decision: Object.freeze({
        requestedValue: preference,
        effectiveFontId: null,
        source: "theme",
      }),
    });
  }

  const requested = catalog.find((entry) => (
    entry.id === preference.fontId && entry.roles.includes("content")
  ));
  const override = requested ?? resolveFontForRole(
    PRODUCT_FONT_ID_BY_ROLE.content,
    "content",
    catalog,
  );
  return Object.freeze({
    override,
    decision: Object.freeze({
      requestedValue: preference,
      effectiveFontId: override.id,
      source: requested ? "user" : "fallback",
    }),
  });
}

function parseContentFontPreference(parsed: Record<string, unknown>): ContentFontPreference {
  if (
    parsed.version === TYPOGRAPHY_PREFERENCE_VERSION
    || parsed.version === 10
    || parsed.version === 9
    || parsed.version === 8
    || parsed.version === 7
    || parsed.version === 6
    || parsed.version === 5
    || parsed.version === 4
  ) {
    if (!isRecord(parsed.contentFont)) return DEFAULT_TYPOGRAPHY_PREFERENCES.contentFont;
    if (parsed.contentFont.mode === "follow-theme") {
      return Object.freeze({ mode: "follow-theme" });
    }
    if (parsed.contentFont.mode === "explicit") {
      const fontId = typeof parsed.contentFont.fontId === "string"
        ? parsed.contentFont.fontId.trim()
        : "";
      if (!FONT_ID_PATTERN.test(fontId)) return DEFAULT_TYPOGRAPHY_PREFERENCES.contentFont;
      return Object.freeze({
        mode: "explicit",
        fontId,
      });
    }
    return DEFAULT_TYPOGRAPHY_PREFERENCES.contentFont;
  }

  const legacyId = typeof parsed.contentFontId === "string"
    ? parsed.contentFontId.trim()
    : "";
  if (!legacyId || legacyId === "theme") return Object.freeze({ mode: "follow-theme" });
  const normalizedId = normalizeFontId(legacyId, "content");
  if (
    (parsed.version === 1 || parsed.version === 2 || parsed.version === undefined)
    && normalizedId === BUILTIN_FONT_IDS.geistSans
  ) {
    return Object.freeze({ mode: "follow-theme" });
  }
  return Object.freeze({ mode: "explicit", fontId: normalizedId });
}

function parseTypographyScale(parsed: Record<string, unknown>): TypographyScale {
  if (parsed.version === TYPOGRAPHY_PREFERENCE_VERSION) {
    return normalizeTypographyScale(parsed.scale);
  }

  // Versions 6-10 stored independent surface scales. The editor was the
  // primary reading-size choice, so it is the deterministic migration source
  // when those values disagree.
  if (
    (parsed.version === 10
      || parsed.version === 9
      || parsed.version === 8
      || parsed.version === 7
      || parsed.version === 6)
    && isRecord(parsed.scales)
  ) {
    return normalizeTypographyScale(parsed.scales.editor);
  }

  const legacySizes = isRecord(parsed.sizes) ? parsed.sizes : {};
  return inferLegacyScale(legacySizes.content, [14, 15, 16]);
}

function normalizeTypographyScale(value: unknown): TypographyScale {
  return value === "small" || value === "large" ? value : "medium";
}

function inferLegacyScale(value: unknown, presetSizes: readonly [number, number, number]): TypographyScale {
  if (!isRecord(value) || value.mode !== "explicit" || typeof value.sizePx !== "number") {
    return "medium";
  }
  const legacySizePx = value.sizePx;
  const distances = presetSizes.map((size) => Math.abs(size - legacySizePx));
  const nearestIndex = distances.indexOf(Math.min(...distances));
  return TYPOGRAPHY_SCALE_OPTIONS[nearestIndex] ?? "medium";
}

function normalizeFontId(value: unknown, role: TypographyPreferenceRole) {
  if (typeof value !== "string") return DEFAULT_FONT_ID_BY_ROLE[role];
  const normalized = value.trim();
  return FONT_ID_PATTERN.test(normalized) ? normalized : DEFAULT_FONT_ID_BY_ROLE[role];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
