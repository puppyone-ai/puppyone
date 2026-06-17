import type { DataNode, FileContent, Workspace } from "@puppyone/data-core";

export type GitStatusEntry = {
  path: string;
  staged: string | null;
  unstaged: string | null;
  status: string;
};

export type GitStatusSnapshot = {
  isRepo: boolean;
  branch: string | null;
  entries: GitStatusEntry[];
};

declare global {
  interface Window {
    puppyoneDesktop?: {
      selectFolder: () => Promise<Workspace | null>;
      workspaceFromPath: (folderPath: string) => Promise<Workspace>;
      getPathForFile: (file: File) => string;
      listFolderChildren: (request: {
        rootPath: string;
        folderPath: string | null;
      }) => Promise<DataNode[]>;
      readFile: (request: {
        rootPath: string;
        path: string;
      }) => Promise<FileContent>;
      writeFile: (request: {
        rootPath: string;
        path: string;
        content: string;
      }) => Promise<void>;
      getGitStatus: (request: {
        rootPath: string;
      }) => Promise<GitStatusSnapshot>;
    };
  }
}

export {};
