import { Terminal, type ITheme } from "@xterm/xterm";
import { TYPOGRAPHY_SCALE_METRICS } from "../../typography";

export type TerminalRgbColor = [number, number, number];

export type TerminalDefaultColors = {
  foreground: TerminalRgbColor;
  background: TerminalRgbColor;
};

export type TerminalAppearance = Readonly<{
  theme: ITheme;
  fontFamily: string;
  fontSize: number;
  defaultColors: TerminalDefaultColors;
}>;

/** Read once from the owning surface, before starting a persistent PTY. */
export function readTerminalAppearance(source: HTMLElement): TerminalAppearance {
  const theme = readTerminalTheme(source);
  return Object.freeze({
    theme,
    fontFamily: readTerminalFontFamily(source),
    fontSize: readTerminalFontSize(source),
    defaultColors: terminalDefaultColorsFromTheme(theme),
  });
}

export function readTerminalTheme(element: HTMLElement): ITheme {
  const source = resolveTerminalAppearanceSource(element);
  return {
    background: cssColor(
      source,
      "--po-terminal-bg",
      cssColor(source, "--po-surface-terminal", "#fafafa"),
    ),
    foreground: cssColor(source, "--po-terminal-fg", cssColor(source, "--po-text", "#2f2a23")),
    cursor: cssColor(source, "--po-terminal-cursor", cssColor(source, "--po-text", "#2f2a23")),
    selectionBackground: cssColor(
      source,
      "--po-terminal-selection",
      cssColor(source, "--po-selected", "rgba(73, 55, 35, 0.17)"),
    ),
    scrollbarSliderBackground: "transparent",
    scrollbarSliderHoverBackground: "transparent",
    scrollbarSliderActiveBackground: "transparent",
    overviewRulerBorder: "transparent",
    black: cssColor(source, "--po-terminal-black", cssColor(source, "--po-text", "#2f2a23")),
    red: cssColor(source, "--po-terminal-red", cssColor(source, "--po-danger", "#dc2626")),
    green: cssColor(source, "--po-terminal-green", cssColor(source, "--po-success", "#15803d")),
    yellow: cssColor(source, "--po-terminal-yellow", cssColor(source, "--po-warning", "#b45309")),
    blue: cssColor(source, "--po-terminal-blue", cssColor(source, "--po-accent", "#2563eb")),
    magenta: cssColor(source, "--po-terminal-magenta", cssColor(source, "--po-purple", "#8057a8")),
    cyan: cssColor(source, "--po-terminal-cyan", cssColor(source, "--po-info", "#0284c7")),
    white: cssColor(source, "--po-terminal-white", cssColor(source, "--po-inset", "#e6ded1")),
    brightBlack: cssColor(
      source,
      "--po-terminal-bright-black",
      cssColor(source, "--po-text-muted", "#70685e"),
    ),
    brightRed: cssColor(source, "--po-terminal-bright-red", cssColor(source, "--po-danger", "#dc2626")),
    brightGreen: cssColor(source, "--po-terminal-bright-green", cssColor(source, "--po-success", "#15803d")),
    brightYellow: cssColor(source, "--po-terminal-bright-yellow", cssColor(source, "--po-warning", "#b45309")),
    brightBlue: cssColor(source, "--po-terminal-bright-blue", cssColor(source, "--po-accent", "#2563eb")),
    brightMagenta: cssColor(source, "--po-terminal-bright-magenta", cssColor(source, "--po-purple", "#8057a8")),
    brightCyan: cssColor(source, "--po-terminal-bright-cyan", cssColor(source, "--po-info", "#0284c7")),
    brightWhite: cssColor(source, "--po-terminal-bright-white", cssColor(source, "--po-text", "#2f2a23")),
  };
}

export function applyTerminalAppearance(terminal: Terminal, appearance: TerminalAppearance) {
  terminal.options.theme = appearance.theme;
  terminal.options.fontFamily = appearance.fontFamily;
  terminal.options.fontSize = appearance.fontSize;
  terminal.refresh(0, Math.max(0, terminal.rows - 1));
  return appearance.defaultColors;
}

export function terminalDefaultColorsFromTheme(theme: ITheme): TerminalDefaultColors {
  return {
    foreground: parseResolvedRgb(theme.foreground, [47, 42, 35]),
    background: parseResolvedRgb(theme.background, [251, 250, 247]),
  };
}

export function readTerminalFontFamily(element: HTMLElement) {
  const source = resolveTerminalAppearanceSource(element);
  return getComputedStyle(source).getPropertyValue("--po-font-terminal").trim()
    || '"Geist Mono", "SFMono-Regular", "SF Mono", Consolas, "Liberation Mono", monospace';
}

export function readTerminalFontSize(element: HTMLElement) {
  const source = resolveTerminalAppearanceSource(element);
  const value = getComputedStyle(source).getPropertyValue("--po-terminal-font-size").trim();
  const fontSize = Number.parseFloat(value);
  return Number.isInteger(fontSize)
    ? fontSize
    : TYPOGRAPHY_SCALE_METRICS.medium.rightSidebar.terminal;
}

/** Detached screens retain their snapshot; they must never guess a global theme. */
export function resolveTerminalAppearanceSource(element: HTMLElement): HTMLElement {
  if (!element.isConnected) throw new Error("Terminal appearance requires its connected owning surface.");
  return element;
}

function cssColor(element: HTMLElement, name: string, fallback: string) {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return resolveCssColor(element, value || fallback);
}

function resolveCssColor(element: HTMLElement, color: string) {
  const probe = element.ownerDocument.createElement("span");
  probe.style.color = color;
  if (!probe.style.color && !color.includes("var(") && !color.includes("color-mix(")) return color;

  probe.style.display = "none";
  element.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || color;
}

function parseResolvedRgb(value: string | undefined, fallback: TerminalRgbColor): TerminalRgbColor {
  if (typeof value !== "string") return fallback;
  const legacyRgb = value.match(
    /^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/iu,
  );
  if (legacyRgb) {
    const channels = legacyRgb.slice(1, 4).map(parseLegacyRgbChannel);
    if (channels.every((channel): channel is number => channel !== null)) {
      return channels as TerminalRgbColor;
    }
  }

  // Chromium serializes computed color-mix() values with CSS Color 4 syntax.
  // xterm accepts that syntax directly, but OSC 10/11 need concrete 8-bit RGB.
  const srgb = value.match(
    /^color\(\s*srgb\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)%?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)%?)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)%?)(?:\s*\/\s*[\d.]+%?)?\s*\)$/iu,
  );
  if (!srgb) return fallback;
  const channels = srgb.slice(1, 4).map(parseSrgbChannel);
  return channels.every((channel): channel is number => channel !== null)
    ? channels as TerminalRgbColor
    : fallback;
}

function parseLegacyRgbChannel(value: string) {
  const percentage = value.endsWith("%");
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return null;
  return clampRgbChannel(percentage ? numeric * 2.55 : numeric);
}

function parseSrgbChannel(value: string) {
  const percentage = value.endsWith("%");
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return null;
  return clampRgbChannel(percentage ? numeric * 2.55 : numeric * 255);
}

function clampRgbChannel(value: number) {
  return Math.min(Math.max(Math.round(value), 0), 255);
}
