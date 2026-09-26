import type { ExperimentalSettings } from "../../preferences";
import { LOCAL_IMPORT_SOURCES } from "../../../shared/project-import/sources.mjs";

export type RepositoryImportSource = "github" | "gitlab";
export type ExperimentalImportSource = "notion" | "google-drive" | "obsidian" | "airtable";
export type LocalFolderImportSource = "obsidian";
export type ImportSourceBrand = string;
export type ImportSourceDescriptor = Readonly<{
  id: ImportSourceBrand;
  label: string;
  mode: "repository" | "remote" | "folder";
  availability: "ready" | "experimental";
  operational: boolean;
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
    .filter(({ preview, operational }) => preview && operational)
    .map(({ id }) => id)
    .slice(0, 3);
}
