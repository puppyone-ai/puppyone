export type LocalImportSource = Readonly<{
  id: string;
  label: string;
  mode: "repository" | "remote" | "folder";
  availability: "ready" | "experimental";
  operational: boolean;
  preview: boolean;
  stepCount?: number;
}>;
export const LOCAL_IMPORT_SOURCES: readonly LocalImportSource[];
