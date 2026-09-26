export type LocalImportSource = Readonly<{
  id: "github" | "gitlab" | "notion" | "google-drive" | "obsidian" | "airtable";
  mode: "repository" | "remote" | "folder";
  availability: "ready" | "experimental";
  operational: boolean;
  preview: boolean;
  stepCount?: number;
}>;
export const LOCAL_IMPORT_SOURCES: readonly LocalImportSource[];
export function getLocalImportSource(id: string): LocalImportSource | null;
