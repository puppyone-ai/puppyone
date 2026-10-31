import type {
  DocumentPersistencePort,
  DocumentStorageIdentity,
} from "../../core/types";
import {
  canonicalizeResourcePath,
  type CanonicalResourcePath,
} from "../../core/resourcePath";
import { isDataResourceUri } from "../../core/dataResourcePath";
import {
  canonicalizeResourceUri,
  type ResourceUri,
} from "../../core/resourceUri";

export type CanonicalDocumentResourcePath = CanonicalResourcePath | ResourceUri;

export type DocumentIdentity = Readonly<{
  storageIdentity: DocumentStorageIdentity;
  resourcePath: CanonicalDocumentResourcePath;
}>;

export function createDocumentIdentity(
  persistence: Pick<DocumentPersistencePort, "storageIdentity">,
  resourcePath: string,
): DocumentIdentity {
  const storageIdentity = persistence.storageIdentity.trim();
  if (!storageIdentity) throw new TypeError("Document storage identity must not be empty.");
  return {
    storageIdentity,
    resourcePath: canonicalizeDocumentResourcePath(resourcePath),
  };
}

export function canonicalizeDocumentResourcePath(
  resourcePath: string,
): CanonicalDocumentResourcePath {
  return isDataResourceUri(resourcePath)
    ? canonicalizeResourceUri(resourcePath)
    : canonicalizeResourcePath(resourcePath);
}

export function getDocumentIdentityKey(identity: DocumentIdentity): string {
  return JSON.stringify([identity.storageIdentity, identity.resourcePath]);
}
