import type { ExperimentalSettings } from "../../preferences";
import { LOCAL_IMPORT_SOURCES } from "../../../shared/project-import/sources.mjs";

export type RepositoryImportSource = "github" | "gitlab";
export type ExperimentalImportSource = "notion" | "google-drive" | "obsidian" | "airtable";
export type ImportSourceBrand = RepositoryImportSource | ExperimentalImportSource;
export type ImportSourceDescriptor = Readonly<{
  id: ImportSourceBrand;
  mode: "repository" | "folder";
  availability: "ready" | "experimental";
  preview: boolean;
  stepCount?: number;
}>;

export const IMPORT_SOURCE_REGISTRY: readonly ImportSourceDescriptor[] = LOCAL_IMPORT_SOURCES;
export const DEFAULT_VISIBLE_IMPORT_SOURCES = IMPORT_SOURCE_REGISTRY.filter(
  ({ availability }) => availability === "ready",
);

export function resolveVisibleImportSources(
  settings: ExperimentalSettings,
): ImportSourceDescriptor[] {
  return IMPORT_SOURCE_REGISTRY.filter((source) => (
    source.availability === "ready"
    || settings.enableOtherAppImports
  ));
}

/** Keep the compact preview restrained even when every experiment is enabled. */
export function resolveImportPreviewBrands(
  settings: ExperimentalSettings,
): ImportSourceBrand[] {
  return resolveVisibleImportSources(settings)
    .filter(({ preview }) => preview)
    .map(({ id }) => id)
    .slice(0, 3);
}
