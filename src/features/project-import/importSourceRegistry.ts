import type { ExperimentalSettings } from "../../preferences";

export type RepositoryImportSource = "github" | "gitlab";
export type ExperimentalImportSource = "notion" | "google-drive" | "obsidian" | "airtable";
export type ImportSourceBrand = RepositoryImportSource | ExperimentalImportSource;
export type ImportExperimentSettingKey =
  | "enableNotionImport"
  | "enableGoogleDriveImport"
  | "enableObsidianImport"
  | "enableAirtableImport";

export type ImportSourceDescriptor = Readonly<{
  id: ImportSourceBrand;
  mode: "repository" | "guided";
  availability: "ready" | "experimental";
  preview: boolean;
  settingKey?: ImportExperimentSettingKey;
  stepCount?: number;
}>;

export const IMPORT_SOURCE_REGISTRY: readonly ImportSourceDescriptor[] = [
  { id: "github", mode: "repository", availability: "ready", preview: true },
  { id: "gitlab", mode: "repository", availability: "ready", preview: true },
  { id: "notion", mode: "guided", availability: "experimental", preview: true, settingKey: "enableNotionImport", stepCount: 3 },
  { id: "google-drive", mode: "guided", availability: "experimental", preview: true, settingKey: "enableGoogleDriveImport", stepCount: 3 },
  { id: "obsidian", mode: "guided", availability: "experimental", preview: true, settingKey: "enableObsidianImport", stepCount: 2 },
  { id: "airtable", mode: "guided", availability: "experimental", preview: true, settingKey: "enableAirtableImport", stepCount: 3 },
];
export const DEFAULT_VISIBLE_IMPORT_SOURCES = IMPORT_SOURCE_REGISTRY.filter(
  ({ availability }) => availability === "ready",
);

export function resolveVisibleImportSources(
  settings: ExperimentalSettings,
): ImportSourceDescriptor[] {
  return IMPORT_SOURCE_REGISTRY.filter((source) => (
    source.availability === "ready"
    || (source.settingKey !== undefined && settings[source.settingKey])
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
