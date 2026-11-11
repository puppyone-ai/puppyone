import type { ExperimentalSettings } from "../../preferences";
import { LOCAL_IMPORT_SOURCES } from "../../../shared/project-import/sources.mjs";

export type RepositoryImportSource = "github" | "gitlab";
export type ExperimentalImportSource = "notion" | "google-drive" | "airtable" | AppFolderSource;
/** Apps whose recorded folders can be listed on the Homepage in place. */
export type AppFolderSource = "obsidian" | "vscode" | "cursor" | "typora";
export type ImportSourceBrand = string;
export type ImportSourceDescriptor = Readonly<{
  id: ImportSourceBrand;
  label: string;
  mode: "repository" | "remote" | "folder" | "app";
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
  settings: Pick<ExperimentalSettings, "enableOtherAppImports">,
): ImportSourceDescriptor[] {
  return IMPORT_SOURCE_REGISTRY.filter((source) => (
    source.availability === "ready"
    || settings.enableOtherAppImports
  ));
}

/** Keep the compact preview restrained even when every experiment is enabled. */
export function resolveImportPreviewBrands(
  settings: Pick<ExperimentalSettings, "enableOtherAppImports">,
): ImportSourceBrand[] {
  return resolveVisibleImportSources(settings)
    .filter(({ preview, operational }) => preview && operational)
    .map(({ id }) => id)
    .slice(0, 3);
}
