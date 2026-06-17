import type { DataNode, Workspace } from "@puppyone/data-core";

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
    };
  }
}

export {};
