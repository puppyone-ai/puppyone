const PREFIX = "puppyone-local://workspace/";

/** Local provider transport identity. This is neither a filesystem path nor a grant. */
export function parseWorkspaceResourceReference(value) {
  if (typeof value !== "string" || value.length > 16_384 || !value.startsWith(PREFIX)) {
    throw new TypeError("A local workspace resource URI is required.");
  }
  const segments = value.slice(PREFIX.length).split("/").map((segment) => {
    const decoded = decodeURIComponent(segment);
    if (!decoded || decoded === "." || decoded === ".." || /[/\\\u0000-\u001f\u007f]/u.test(decoded)) {
      throw new TypeError("Invalid workspace resource segment.");
    }
    return decoded;
  });
  const [folderId, ...relativeSegments] = segments;
  return { folderId, relativePath: relativeSegments.join("/") || "." };
}

export function isWorkspaceResourceReference(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function createWorkspaceResourceReference(folderId, relativePath = ".") {
  const segments = [folderId, ...(relativePath === "." ? [] : relativePath.split("/"))];
  const resourceUri = PREFIX + segments.map(encodeURIComponent).join("/");
  parseWorkspaceResourceReference(resourceUri);
  return resourceUri;
}

/** Synchronous display/export projection; native consumers must reauthorize it. */
export function projectLocalResourcePath(rootPath, relativePath) {
  if (typeof rootPath !== "string" || !/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\]+\\)/.test(rootPath)
    || /[\u0000-\u001f\u007f]/u.test(rootPath)) {
    throw new TypeError("An absolute local root is required.");
  }
  if (relativePath === "." || relativePath === "") return rootPath;
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || /[\\\u0000-\u001f\u007f]/u.test(segment))) {
    throw new TypeError("A provider-relative path is required.");
  }
  const separator = /^[A-Za-z]:\\|^\\\\/.test(rootPath) ? "\\" : "/";
  return rootPath.replace(/[/\\]+$/, "") + separator + segments.join(separator);
}

/** Browser-safe file URL serialization without treating POSIX backslashes as separators. */
export function localResourceFileUrl(absolutePath) {
  projectLocalResourcePath(absolutePath, ".");
  const encodePath = (value) => value.split("/").map(encodeURIComponent).join("/");
  if (/^[A-Za-z]:[\\/]/.test(absolutePath)) {
    return `file:///${absolutePath.slice(0, 2)}/${encodePath(absolutePath.slice(3).replace(/\\/g, "/"))}`;
  }
  if (absolutePath.startsWith("\\\\")) {
    return `file://${encodePath(absolutePath.slice(2).replace(/\\/g, "/"))}`;
  }
  return `file://${encodePath(absolutePath)}`;
}
