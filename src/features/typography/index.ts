export {
  BUILTIN_FONT_CATALOG,
  BUILTIN_FONT_IDS,
  DEFAULT_TYPOGRAPHY_PREFERENCES,
  TYPOGRAPHY_PREFERENCE_VERSION,
  TYPOGRAPHY_PRODUCT_DEFAULT_SCALES,
  TYPOGRAPHY_SCALE_METRICS,
  TYPOGRAPHY_SCALE_OPTIONS,
  createCatalogFontFamily,
  followThemeContentFont,
  getFontCatalogEntries,
  isFollowingThemeContentFont,
  isValidFontCatalogEntry,
  parseTypographyPreferences,
  resolveTypography,
  withTypographyFont,
  withTypographyScale,
} from "./fontCatalog";
export type {
  FontCatalogEntry,
  FontCategory,
  ContentFontPreference,
  FontSourceKind,
  ResolvedTypography,
  ResolvedContentFontDecision,
  TypographyPreferences,
  TypographyRole,
  TypographyScale,
  TypographyScalePreferences,
  TypographyScaleSurface,
} from "./fontCatalog";
export {
  applyTypographyToElement,
  createTypographyRootProps,
  useTypographyRuntime,
} from "./typographyRuntime";
export type { TypographyRootProps } from "./typographyRuntime";
export {
  TypographyCatalogProvider,
  useTypographyCatalog,
} from "./TypographyCatalogContext";
