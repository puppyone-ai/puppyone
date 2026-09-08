import type { FileIconThemeId } from "@puppyone/shared-ui";
import {
  getSidebarNavigationOrientation,
  getSidebarNavigationPlacement,
  resolveActiveThemeMode,
  type SidebarNavigationLayout,
  type SidebarNavigationOrientation,
  type SidebarNavigationPlacement,
  type ThemeMode,
} from "../../preferences";
import {
  getDefaultSubThemeId,
  getInterfaceStyleDefinition,
  type InterfaceStyle,
  type ResolvedTheme,
} from "./interfaceStyles";
import { BUILTIN_SUB_THEMES } from "../themes/builtinSubThemes";
import {
  getSubThemeVariant,
  type SubThemeCatalogSnapshot,
  type SubThemeDefinition,
} from "../themes/themeTypes";

export type AppearanceSettingStatus = "editable" | "constrained" | "forced" | "unavailable";
export type AppearanceDecisionSource =
  | "accessibility"
  | "platform"
  | "sub-theme"
  | "style-surface"
  | "style"
  | "user"
  | "default";

export type AppearanceSettingDecision<T> = Readonly<{
  requestedValue: T;
  effectiveValue: T;
  status: AppearanceSettingStatus;
  source: AppearanceDecisionSource;
  reasonKey?: string;
  allowedValues?: readonly T[];
}>;

export type AppearancePolicy<T extends string> =
  | Readonly<{ mode: "inherit" }>
  | Readonly<{ mode: "allow"; values: readonly T[]; default?: T }>
  | Readonly<{ mode: "force"; value: T; reasonKey: string }>
  | Readonly<{ mode: "unavailable"; reasonKey: string }>;

export type AppearanceDiagnostic = Readonly<{
  code: "sub-theme-missing" | "sub-theme-incompatible" | "sub-theme-mode-unsupported";
  requestedSubThemeId: string;
  effectiveSubThemeId: string;
}>;

export type AppearanceResolutionInput = Readonly<{
  interfaceStyle: InterfaceStyle;
  themeMode: ThemeMode;
  systemColorMode?: ResolvedTheme;
  requestedSubThemeIds?: Readonly<Partial<Record<ResolvedTheme, string>>>;
  subThemeCatalog?: SubThemeCatalogSnapshot;
  sidebarNavigationLayout: SidebarNavigationLayout;
  fileIconTheme: FileIconThemeId;
}>;

export type ResolvedAppearance = Readonly<{
  rootThemeId: InterfaceStyle;
  interfaceStyle: InterfaceStyle;
  profile: ReturnType<typeof getInterfaceStyleDefinition>["profile"];
  tokenSet: string;
  composition: ReturnType<typeof getInterfaceStyleDefinition>["composition"];
  subTheme: SubThemeDefinition;
  subThemeId: string;
  requestedColorMode: ThemeMode;
  effectiveColorMode: ResolvedTheme;
  legacyThemePreset: string;
  appearanceRevision: string;
  diagnostics: readonly AppearanceDiagnostic[];
  decisions: Readonly<{
    subTheme: AppearanceSettingDecision<string>;
    themeMode: AppearanceSettingDecision<ThemeMode>;
    sidebarNavigationLayout: AppearanceSettingDecision<SidebarNavigationLayout>;
    fileIconTheme: AppearanceSettingDecision<FileIconThemeId>;
  }>;
  themeMode: ThemeMode;
  sidebarNavigationLayout: SidebarNavigationLayout;
  sidebarNavigationPlacement: SidebarNavigationPlacement;
  sidebarNavigationOrientation: SidebarNavigationOrientation;
  fileIconTheme: FileIconThemeId;
}>;

const BUILTIN_SUB_THEME_CATALOG: SubThemeCatalogSnapshot = Object.freeze({
  subThemes: BUILTIN_SUB_THEMES,
  diagnostics: Object.freeze([]),
});

export function resolveAppearance(input: AppearanceResolutionInput): ResolvedAppearance {
  const rootTheme = getInterfaceStyleDefinition(input.interfaceStyle);
  const themeMode = resolveSetting(
    input.themeMode,
    rootTheme.policies.themeMode as AppearancePolicy<ThemeMode>,
    resolveActiveThemeMode(input.interfaceStyle, input.themeMode),
  );
  const effectiveColorMode = themeMode.effectiveValue === "system"
    ? input.systemColorMode ?? "light"
    : themeMode.effectiveValue;
  const subThemeResolution = resolveSubTheme({
    catalog: input.subThemeCatalog ?? BUILTIN_SUB_THEME_CATALOG,
    effectiveColorMode,
    requestedSubThemeId: input.requestedSubThemeIds?.[effectiveColorMode]
      ?? getDefaultSubThemeId(input.interfaceStyle, effectiveColorMode),
    rootTheme,
  });
  const sidebarNavigationLayout = resolveSetting(
    input.sidebarNavigationLayout,
    rootTheme.policies.sidebarNavigationLayout as AppearancePolicy<SidebarNavigationLayout>,
    input.sidebarNavigationLayout,
  );
  const fileIconTheme = resolveSetting(
    input.fileIconTheme,
    rootTheme.policies.fileIconTheme as AppearancePolicy<FileIconThemeId>,
    input.fileIconTheme,
  );
  const legacyThemePreset = subThemeResolution.subTheme.legacyPresets?.[effectiveColorMode]
    ?? (effectiveColorMode === "light" ? "neutral" : "default");

  return Object.freeze({
    rootThemeId: input.interfaceStyle,
    interfaceStyle: input.interfaceStyle,
    profile: rootTheme.profile,
    tokenSet: rootTheme.tokenSet,
    composition: rootTheme.composition,
    subTheme: subThemeResolution.subTheme,
    subThemeId: subThemeResolution.subTheme.id,
    requestedColorMode: input.themeMode,
    effectiveColorMode,
    legacyThemePreset,
    appearanceRevision: [
      input.interfaceStyle,
      subThemeResolution.subTheme.id,
      effectiveColorMode,
    ].join(":"),
    diagnostics: subThemeResolution.diagnostics,
    decisions: Object.freeze({
      subTheme: subThemeResolution.decision,
      themeMode,
      sidebarNavigationLayout,
      fileIconTheme,
    }),
    themeMode: themeMode.effectiveValue,
    sidebarNavigationLayout: sidebarNavigationLayout.effectiveValue,
    sidebarNavigationPlacement: getSidebarNavigationPlacement(sidebarNavigationLayout.effectiveValue),
    sidebarNavigationOrientation: getSidebarNavigationOrientation(sidebarNavigationLayout.effectiveValue),
    fileIconTheme: fileIconTheme.effectiveValue,
  });
}

function resolveSubTheme({
  catalog,
  effectiveColorMode,
  requestedSubThemeId,
  rootTheme,
}: {
  catalog: SubThemeCatalogSnapshot;
  effectiveColorMode: ResolvedTheme;
  requestedSubThemeId: string;
  rootTheme: ReturnType<typeof getInterfaceStyleDefinition>;
}) {
  const byId = new Map(catalog.subThemes.map((subTheme) => [subTheme.id, subTheme]));
  const requested = byId.get(requestedSubThemeId);
  const compatibility = requested
    ? getSubThemeCompatibility(requested, rootTheme, effectiveColorMode)
    : "missing";
  const fallbackId = getDefaultSubThemeId(rootTheme.id, effectiveColorMode);
  const fallback = byId.get(fallbackId);
  if (!fallback || getSubThemeCompatibility(fallback, rootTheme, effectiveColorMode) !== "compatible") {
    throw new Error(`Root Theme ${rootTheme.id} has no compatible default Sub Theme.`);
  }
  if (compatibility === "compatible" && requested) {
    return Object.freeze({
      subTheme: requested,
      decision: Object.freeze({
        requestedValue: requestedSubThemeId,
        effectiveValue: requested.id,
        status: "editable" as const,
        source: "user" as const,
      }),
      diagnostics: Object.freeze([]) as readonly AppearanceDiagnostic[],
    });
  }
  const code = compatibility === "missing"
    ? "sub-theme-missing"
    : compatibility === "mode-unsupported"
      ? "sub-theme-mode-unsupported"
      : "sub-theme-incompatible";
  return Object.freeze({
    subTheme: fallback,
    decision: Object.freeze({
      requestedValue: requestedSubThemeId,
      effectiveValue: fallback.id,
      status: "constrained" as const,
      source: "style" as const,
      reasonKey: `settings.appearance.subTheme.${code}`,
    }),
    diagnostics: Object.freeze([Object.freeze({
      code,
      requestedSubThemeId,
      effectiveSubThemeId: fallback.id,
    })]),
  });
}

function getSubThemeCompatibility(
  subTheme: SubThemeDefinition,
  rootTheme: ReturnType<typeof getInterfaceStyleDefinition>,
  effectiveColorMode: ResolvedTheme,
): "compatible" | "root-incompatible" | "mode-unsupported" | "target-incomplete" {
  if (!subTheme.compatibleRootThemeIds.includes(rootTheme.id)) return "root-incompatible";
  if (!getSubThemeVariant(subTheme, effectiveColorMode)) return "mode-unsupported";
  if (!rootTheme.subThemes.allowedTargets.every((target) => subTheme.targets.includes(target))) {
    return "target-incomplete";
  }
  return "compatible";
}

export function resolveSetting<T extends string>(
  requestedValue: T,
  policy: AppearancePolicy<T>,
  inheritedValue: T,
): AppearanceSettingDecision<T> {
  if (policy.mode === "force") {
    return Object.freeze({
      requestedValue,
      effectiveValue: policy.value,
      status: "forced",
      source: "style",
      reasonKey: policy.reasonKey,
    });
  }
  if (policy.mode === "allow") {
    const allowed = policy.values.includes(requestedValue);
    return Object.freeze({
      requestedValue,
      effectiveValue: allowed ? requestedValue : (policy.default ?? policy.values[0] ?? inheritedValue),
      status: allowed ? "editable" : "constrained",
      source: allowed ? "user" : "style",
      allowedValues: Object.freeze([...policy.values]),
    });
  }
  if (policy.mode === "unavailable") {
    return Object.freeze({
      requestedValue,
      effectiveValue: inheritedValue,
      status: "unavailable",
      source: "style",
      reasonKey: policy.reasonKey,
    });
  }
  return Object.freeze({
    requestedValue,
    effectiveValue: inheritedValue,
    status: "editable",
    source: "user",
  });
}

export function isAppearanceDecisionLocked<T>(decision: AppearanceSettingDecision<T>): boolean {
  return decision.status === "forced" || decision.status === "unavailable";
}

export function isAppearanceValueAllowed<T>(
  decision: AppearanceSettingDecision<T>,
  value: T,
): boolean {
  return decision.allowedValues?.includes(value) ?? true;
}
