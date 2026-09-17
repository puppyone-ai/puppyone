import { unsupportedOfficeDocumentConverter } from "../common/unsupported-document-converter.mjs";

export const WINDOWS_TITLE_BAR_OVERLAY_HEIGHT = 38;

export function createWindowsPlatformAdapter({ arch }) {
  return Object.freeze({
    platform: "windows",
    arch,
    primaryModifier: "control",
    windowChrome: Object.freeze({
      mode: "overlay",
      browserWindowOptions: Object.freeze({
        autoHideMenuBar: true,
        titleBarStyle: "hidden",
        titleBarOverlay: Object.freeze(createWindowsTitleBarOverlay("#fafafa")),
      }),
      focusApplication: () => undefined,
      supportsDockIcon: false,
      shouldReapplyProfile: false,
      synchronizeAppearance: (window, { background, themeSource, titlebarBackground }) => {
        window.setTitleBarOverlay?.(
          createWindowsTitleBarOverlay(titlebarBackground ?? background, {
            fallbackBackground: background,
            themeSource,
          }),
        );
      },
    }),
    documents: Object.freeze({
      supportedInputs: Object.freeze([]),
      convertOfficeDocumentToDocx: unsupportedOfficeDocumentConverter,
    }),
    updater: Object.freeze({ supported: true, installMode: "nsis" }),
  });
}

export function createWindowsTitleBarOverlay(background, options = {}) {
  return {
    color: "#00000000",
    symbolColor: resolveWindowsTitleBarSymbolColor(background, options),
    height: WINDOWS_TITLE_BAR_OVERLAY_HEIGHT,
  };
}

export function resolveWindowsTitleBarSymbolColor(background, {
  fallbackBackground = null,
  themeSource = null,
} = {}) {
  const components = parseColorComponents(background)
    ?? parseColorComponents(fallbackBackground);
  if (!components) return themeSource === "dark" ? "#f5f5f5" : "#1f1f1f";
  const linearComponents = components.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = (0.2126 * linearComponents[0])
    + (0.7152 * linearComponents[1])
    + (0.0722 * linearComponents[2]);
  return luminance > 0.179 ? "#1f1f1f" : "#f5f5f5";
}

function parseColorComponents(value) {
  const color = String(value ?? "").trim();
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(color);
  if (hex) return hex.slice(1).map((component) => Number.parseInt(component, 16));

  const legacyRgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*1(?:\.0+)?)?\s*\)$/iu.exec(color);
  if (legacyRgb) return validateRgbComponents(legacyRgb.slice(1).map(Number));

  const modernRgb = /^rgba?\(\s*(\d{1,3}(?:\.\d+)?)\s+(\d{1,3}(?:\.\d+)?)\s+(\d{1,3}(?:\.\d+)?)(?:\s*\/\s*1(?:\.0+)?)?\s*\)$/iu.exec(color);
  if (modernRgb) return validateRgbComponents(modernRgb.slice(1).map(Number));

  // Chromium preserves color-mix() results as CSS Color 4 `color(srgb ...)`
  // values in getComputedStyle(). Accept that browser-owned serialization so
  // native caption controls keep the same contrast as renderer-owned actions.
  const srgb = /^color\(\s*srgb\s+(-?(?:\d+(?:\.\d*)?|\.\d+))\s+(-?(?:\d+(?:\.\d*)?|\.\d+))\s+(-?(?:\d+(?:\.\d*)?|\.\d+))(?:\s*\/\s*1(?:\.0+)?)?\s*\)$/iu.exec(color);
  if (!srgb) return null;
  const normalized = srgb.slice(1).map(Number);
  if (!normalized.every((component) => component >= 0 && component <= 1)) return null;
  return normalized.map((component) => component * 255);
}

function validateRgbComponents(components) {
  return components.every((component) => component >= 0 && component <= 255)
    ? components
    : null;
}
