/**
 * Pre-v6 Appearance compatibility. This module is deliberately isolated from
 * the active preferences API so retired content-size state cannot leak back
 * into runtime consumers.
 */
export type LegacyTextSize = "small" | "default" | "large";

export const LEGACY_TEXT_SIZE_STORAGE_KEY = "puppyone.desktop.textSize";
export const DEFAULT_LEGACY_TEXT_SIZE: LegacyTextSize = "default";

export function parseLegacyTextSize(
  value: string | null | undefined,
): LegacyTextSize {
  return value === "small" || value === "large" || value === "default"
    ? value
    : DEFAULT_LEGACY_TEXT_SIZE;
}
