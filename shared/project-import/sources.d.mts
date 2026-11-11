export type LocalImportSource = Readonly<{
  id: string;
  label: string;
  mode: "repository" | "remote" | "folder" | "app";
  availability: "ready" | "experimental";
  operational: boolean;
  preview: boolean;
  stepCount?: number;
}>;
export const LOCAL_IMPORT_SOURCES: readonly LocalImportSource[];
