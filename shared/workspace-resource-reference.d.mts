export function parseWorkspaceResourceReference(value: string): { folderId: string; relativePath: string };
export function isWorkspaceResourceReference(value: unknown): value is string;
export function createWorkspaceResourceReference(folderId: string, relativePath?: string): string;
export function projectLocalResourcePath(rootPath: string, relativePath: string): string;
export function localResourceFileUrl(absolutePath: string): string;
