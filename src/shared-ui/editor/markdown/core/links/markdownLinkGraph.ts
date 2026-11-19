import type {
  MarkdownBacklink,
  MarkdownBacklinkReference,
  MarkdownLinkGraph,
  MarkdownWikiLinkResolvedTarget,
} from "../../../registry/viewerTypes";
import { findMarkdownLinkTokens, isExternalMarkdownHref } from "./markdownLinkModel";
import { findWikiLinkTokens, splitWikiLinkTarget } from "./wikiLinkModel";
import { normalizeDataResourcePath } from "../../../../core/dataResourcePath";

export type MarkdownLinkGraphDocument = {
  path: string;
  name: string;
  content?: string | null;
};

export type MarkdownLinkGraphIndexSnapshot = {
  indexedDocumentCount: number;
  truncatedDocumentCount?: number;
  backlinks: Array<[string, MarkdownBacklink[]]>;
};

export const EMPTY_MARKDOWN_LINK_GRAPH_INDEX: MarkdownLinkGraphIndexSnapshot = {
  indexedDocumentCount: 0,
  backlinks: [],
};

type IndexedDocument = {
  path: string;
  name: string;
  title: string;
  normalizedPath: string;
  normalizedPathWithoutExtension: string;
  content: string | null;
};

export type MarkdownLinkGraphIndexer = {
  indexDocument(document: MarkdownLinkGraphDocument): void;
  createSnapshot(): MarkdownLinkGraphIndexSnapshot;
};

const MAX_INDEXED_LINKS_PER_DOCUMENT = 20_000;
const MAX_STORED_BACKLINKS = 8_000;
const MAX_STORED_REFERENCES_PER_SOURCE_TARGET = 8;
const MAX_STORED_BACKLINK_REFERENCES = 8_000;
const MAX_BACKLINK_LINE_TEXT_LENGTH = 320;

export function createMarkdownLinkGraph(
  documents: readonly MarkdownLinkGraphDocument[],
  indexSnapshot?: MarkdownLinkGraphIndexSnapshot,
  revision = 0,
): MarkdownLinkGraph {
  const indexedDocuments = documents.map(toIndexedDocument).sort((left, right) => left.path.localeCompare(right.path));
  const pathIndex = createPathIndex(indexedDocuments);
  const titleIndex = createTitleIndex(indexedDocuments);
  const backlinksByTargetPath = indexSnapshot
    ? new Map(indexSnapshot.backlinks)
    : createBacklinkIndex(indexedDocuments);

  const resolveWikiLink = (sourcePath: string, target: string): MarkdownWikiLinkResolvedTarget => {
    const resolved = resolveWikiLinkTarget(indexedDocuments, pathIndex, titleIndex, sourcePath, target);
    return resolved;
  };

  return {
    revision,
    documentCount: indexedDocuments.length,
    indexedDocumentCount: indexSnapshot?.indexedDocumentCount
      ?? indexedDocuments.filter((document) => document.content !== null).length,
    resolveWikiLink,
    resolveMarkdownLink(sourcePath, href) {
      const target = normalizeMarkdownHrefTarget(href);
      if (!target) return null;
      return resolveWikiLinkTarget(indexedDocuments, pathIndex, titleIndex, sourcePath, target);
    },
    getBacklinks(path) {
      return backlinksByTargetPath.get(normalizeDataPath(path)) ?? [];
    },
  };
}

/** Pure-data index build. This is the worker boundary used by DataWorkspace. */
export function createMarkdownLinkGraphIndex(
  documents: readonly MarkdownLinkGraphDocument[],
): MarkdownLinkGraphIndexSnapshot {
  const indexer = createMarkdownLinkGraphIndexer(documents);
  for (const document of documents) indexer.indexDocument(document);
  return indexer.createSnapshot();
}

function createBacklinkIndex(
  documents: readonly IndexedDocument[],
): Map<string, MarkdownBacklink[]> {
  const indexer = createMarkdownLinkGraphIndexer(documents);
  for (const document of documents) {
    indexer.indexDocument({
      path: document.path,
      name: document.name,
      content: document.content,
    });
  }
  return new Map(indexer.createSnapshot().backlinks);
}

/**
 * Incremental, bounded backlink builder used inside the indexing Worker. It
 * retains metadata and compact backlink excerpts, never full document source.
 * Re-indexing one source first removes that source's previous contributions.
 */
export function createMarkdownLinkGraphIndexer(
  metadataDocuments: readonly MarkdownLinkGraphDocument[],
): MarkdownLinkGraphIndexer {
  const documents = metadataDocuments
    .map((document) => toIndexedDocument({ ...document, content: null }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const documentByPath = new Map(documents.map((document) => [normalizeLookupKey(document.path), document]));
  const pathIndex = createPathIndex(documents);
  const titleIndex = createTitleIndex(documents);
  const backlinksByTargetPath = new Map<string, Map<string, MarkdownBacklink>>();
  const targetPathsBySource = new Map<string, Set<string>>();
  const indexedSourcePaths = new Set<string>();
  const truncatedSourcePaths = new Set<string>();
  let storedBacklinkCount = 0;
  let storedReferenceCount = 0;

  const removeSource = (sourcePath: string) => {
    const normalizedSourcePath = normalizeLookupKey(sourcePath);
    for (const targetPath of targetPathsBySource.get(normalizedSourcePath) ?? []) {
      const sourceMap = backlinksByTargetPath.get(targetPath);
      const existing = sourceMap?.get(sourcePath);
      if (existing) {
        storedBacklinkCount -= 1;
        storedReferenceCount -= existing.references.length;
      }
      sourceMap?.delete(sourcePath);
      if (sourceMap?.size === 0) backlinksByTargetPath.delete(targetPath);
    }
    targetPathsBySource.delete(normalizedSourcePath);
    indexedSourcePaths.delete(normalizedSourcePath);
    truncatedSourcePaths.delete(normalizedSourcePath);
  };

  return {
    indexDocument(document) {
      removeSource(document.path);
      if (typeof document.content !== "string") return;

      const source = documentByPath.get(normalizeLookupKey(document.path))
        ?? toIndexedDocument({ ...document, content: null });
      const content = document.content;
      const normalizedSourcePath = normalizeLookupKey(source.path);
      const lineStarts = createLineStarts(content);
      const targetCache = new Map<string, MarkdownWikiLinkResolvedTarget>();
      const sourceTargetPaths = new Set<string>();
      const resolveTarget = (target: string) => {
        const cached = targetCache.get(target);
        if (cached) return cached;
        const resolved = resolveWikiLinkTarget(documents, pathIndex, titleIndex, source.path, target);
        targetCache.set(target, resolved);
        return resolved;
      };
      const sourceLinks = [
        ...findWikiLinkTokens(content).map((token) => ({
          from: token.from,
          resolvedTarget: token.target,
          sourceTarget: token.target,
          label: token.label,
        })),
        ...findMarkdownLinkTokens(content).flatMap((token) => {
          const resolvedTarget = normalizeMarkdownHrefTarget(token.href);
          return resolvedTarget
            ? [{
                from: token.from,
                resolvedTarget,
                sourceTarget: token.href,
                label: token.label,
              }]
            : [];
        }),
      ].sort((left, right) => left.from - right.from);

      indexedSourcePaths.add(normalizedSourcePath);
      if (sourceLinks.length > MAX_INDEXED_LINKS_PER_DOCUMENT) {
        truncatedSourcePaths.add(normalizedSourcePath);
      }

      for (const sourceLink of sourceLinks.slice(0, MAX_INDEXED_LINKS_PER_DOCUMENT)) {
        const target = resolveTarget(sourceLink.resolvedTarget);
        if (!target.exists || !target.path) continue;

        const normalizedTargetPath = normalizeDataPath(target.path);
        const sourceMap = getOrCreateMap(backlinksByTargetPath, normalizedTargetPath);
        const existing = sourceMap.get(source.path);
        if (existing) {
          existing.count += 1;
          if (
            existing.references.length < MAX_STORED_REFERENCES_PER_SOURCE_TARGET
            && storedReferenceCount < MAX_STORED_BACKLINK_REFERENCES
          ) {
            existing.references.push(createBacklinkReference(
              content,
              lineStarts,
              sourceLink.from,
              sourceLink.sourceTarget,
              sourceLink.label,
            ));
            storedReferenceCount += 1;
          } else {
            truncatedSourcePaths.add(normalizedSourcePath);
          }
        } else {
          if (storedBacklinkCount >= MAX_STORED_BACKLINKS) {
            truncatedSourcePaths.add(normalizedSourcePath);
            continue;
          }
          const references = storedReferenceCount < MAX_STORED_BACKLINK_REFERENCES
            ? [createBacklinkReference(
                content,
                lineStarts,
                sourceLink.from,
                sourceLink.sourceTarget,
                sourceLink.label,
              )]
            : [];
          if (references.length === 0) truncatedSourcePaths.add(normalizedSourcePath);
          storedBacklinkCount += 1;
          storedReferenceCount += references.length;
          sourceMap.set(source.path, {
            sourcePath: source.path,
            sourceName: source.name,
            count: 1,
            references,
          });
        }
        sourceTargetPaths.add(normalizedTargetPath);
      }
      targetPathsBySource.set(normalizedSourcePath, sourceTargetPaths);
    },
    createSnapshot() {
      const backlinks: Array<[string, MarkdownBacklink[]]> = [];
      for (const [targetPath, sourceMap] of backlinksByTargetPath) {
        backlinks.push([
          targetPath,
          [...sourceMap.values()]
            .map((backlink) => ({
              ...backlink,
              references: backlink.references.map((reference) => ({ ...reference })),
            }))
            .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
        ]);
      }
      backlinks.sort(([left], [right]) => left.localeCompare(right));
      return {
        indexedDocumentCount: indexedSourcePaths.size,
        truncatedDocumentCount: truncatedSourcePaths.size,
        backlinks,
      };
    },
  };
}

function normalizeMarkdownHrefTarget(href: string): string | null {
  const value = href.trim();
  if (!value || value.startsWith("#") || isExternalMarkdownHref(value)) return null;

  const withoutQuery = value.split("?")[0] ?? value;
  const hashIndex = withoutQuery.indexOf("#");
  const rawPath = hashIndex === -1 ? withoutQuery : withoutQuery.slice(0, hashIndex);
  const rawHeading = hashIndex === -1 ? "" : withoutQuery.slice(hashIndex + 1);
  const decodedPath = decodeMarkdownHrefPath(rawPath);
  const decodedHeading = decodeMarkdownHrefPath(rawHeading);
  if (!decodedPath && !decodedHeading) return null;
  return decodedHeading ? `${decodedPath}#${decodedHeading}` : decodedPath;
}

function decodeMarkdownHrefPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").trim();
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function createBacklinkReference(
  content: string,
  lineStarts: readonly number[],
  offset: number,
  target: string,
  label: string,
): MarkdownBacklinkReference {
  const lineIndex = findLineIndex(lineStarts, offset);
  const lineNumber = lineIndex + 1;
  const lineStart = lineStarts[lineIndex] ?? 0;
  const nextLineStart = lineStarts[lineIndex + 1];
  const lineEnd = typeof nextLineStart === "number" ? Math.max(lineStart, nextLineStart - 1) : content.length;
  // Reserve room for both truncation marks so the serialized reference has a
  // strict total bound, not merely a bounded source slice.
  const excerptBudget = MAX_BACKLINK_LINE_TEXT_LENGTH - 2;
  const preferredContextBefore = Math.floor(excerptBudget * 0.35);
  let excerptStart = Math.max(lineStart, offset - preferredContextBefore);
  let excerptEnd = Math.min(lineEnd, excerptStart + excerptBudget);
  excerptStart = Math.max(lineStart, excerptEnd - excerptBudget);
  const prefix = excerptStart > lineStart ? "…" : "";
  const suffix = excerptEnd < lineEnd ? "…" : "";
  const rawLine = `${prefix}${content.slice(excerptStart, excerptEnd).trim()}${suffix}`;

  return {
    lineNumber,
    lineText: rawLine.trim(),
    target,
    label,
  };
}

function createLineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function findLineIndex(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((lineStarts[middle] ?? 0) <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
}

function resolveWikiLinkTarget(
  documents: readonly IndexedDocument[],
  pathIndex: Map<string, IndexedDocument>,
  titleIndex: Map<string, IndexedDocument[]>,
  sourcePath: string,
  target: string,
): MarkdownWikiLinkResolvedTarget {
  const parts = splitWikiLinkTarget(target);
  const rawTargetPath = parts.targetPath.trim();
  const targetPath = normalizeDataPath(rawTargetPath);
  const sourceDocument = pathIndex.get(normalizeDataPath(sourcePath)) ?? null;
  const sourceFolder = sourceDocument ? getParentPath(sourceDocument.path) : getParentPath(sourcePath);

  if (!targetPath && parts.heading && sourceDocument) {
    return createResolvedTarget(sourceDocument, target, parts.heading, false);
  }

  const pathCandidates = createPathCandidates(rawTargetPath, sourceFolder);
  for (const candidate of pathCandidates) {
    const exactMatch = pathIndex.get(candidate);
    if (exactMatch) return createResolvedTarget(exactMatch, target, parts.heading, false);
  }

  const titleMatches = titleIndex.get(normalizeLookupKey(stripKnownFileExtension(getBaseName(targetPath)))) ?? [];
  if (titleMatches.length === 1) {
    return createResolvedTarget(titleMatches[0], target, parts.heading, false);
  }

  if (titleMatches.length > 1) {
    const nearest = pickNearestDocument(titleMatches, sourceFolder);
    return createResolvedTarget(nearest, target, parts.heading, true);
  }

  const candidatePaths = createNavigationPathCandidates(rawTargetPath, sourceFolder);
  return {
    exists: false,
    ambiguous: false,
    path: null,
    candidatePaths,
    name: getBaseName(targetPath) || target,
    displayName: getDisplayNameFromTarget(target),
    target,
    heading: parts.heading,
  };
}

function createResolvedTarget(
  document: IndexedDocument,
  target: string,
  heading: string | null,
  ambiguous: boolean,
): MarkdownWikiLinkResolvedTarget {
  return {
    exists: true,
    ambiguous,
    path: document.path,
    candidatePaths: [document.path],
    name: document.name,
    displayName: document.title,
    target,
    heading,
  };
}

function createPathCandidates(targetPath: string, sourceFolder: string | null): string[] {
  if (!targetPath) return [];

  const candidates: string[] = [];
  const normalizedTarget = normalizeDataPath(targetPath);
  const isRooted = targetPath.startsWith("/");

  if (!isRooted && sourceFolder) {
    addPathCandidate(candidates, joinDataPath(sourceFolder, targetPath));
  }

  addPathCandidate(candidates, normalizedTarget);
  return candidates;
}

function addPathCandidate(candidates: string[], path: string) {
  const normalizedPath = normalizeDataPath(path);
  if (!normalizedPath) return;

  const variants = [
    normalizedPath,
    stripKnownFileExtension(normalizedPath),
    hasMarkdownExtension(normalizedPath) ? normalizedPath : `${normalizedPath}.md`,
    hasMarkdownExtension(normalizedPath) ? normalizedPath : `${normalizedPath}.markdown`,
  ];

  for (const variant of variants) {
    const normalizedVariant = normalizeLookupKey(normalizeDataPath(variant));
    if (normalizedVariant && !candidates.includes(normalizedVariant)) candidates.push(normalizedVariant);
  }
}

function createNavigationPathCandidates(targetPath: string, sourceFolder: string | null): string[] {
  if (!targetPath) return [];

  const candidates: string[] = [];
  const normalizedTarget = normalizeDataPath(targetPath);
  const isRooted = targetPath.startsWith("/");

  if (!isRooted && sourceFolder) {
    addNavigationPathCandidate(candidates, `${sourceFolder}/${targetPath}`);
  }

  addNavigationPathCandidate(candidates, normalizedTarget);
  return candidates;
}

function addNavigationPathCandidate(candidates: string[], path: string) {
  const normalizedPath = normalizeDataPath(path);
  if (!normalizedPath) return;

  const variants = [
    normalizedPath,
    hasKnownFileExtension(normalizedPath) ? null : `${normalizedPath}.md`,
    hasKnownFileExtension(normalizedPath) ? null : `${normalizedPath}.markdown`,
    stripKnownFileExtension(normalizedPath),
  ].filter((value): value is string => Boolean(value));

  for (const variant of variants) {
    const normalizedVariant = normalizeDataPath(variant);
    if (!normalizedVariant) continue;
    if (!candidates.some((candidate) => normalizeLookupKey(candidate) === normalizeLookupKey(normalizedVariant))) {
      candidates.push(normalizedVariant);
    }
  }
}

function createPathIndex(documents: readonly IndexedDocument[]): Map<string, IndexedDocument> {
  const index = new Map<string, IndexedDocument>();
  for (const document of documents) {
    index.set(document.normalizedPath, document);
    index.set(document.normalizedPathWithoutExtension, document);
  }
  return index;
}

function createTitleIndex(documents: readonly IndexedDocument[]): Map<string, IndexedDocument[]> {
  const index = new Map<string, IndexedDocument[]>();
  for (const document of documents) {
    const titleKey = normalizeLookupKey(document.title);
    const current = index.get(titleKey);
    if (current) current.push(document);
    else index.set(titleKey, [document]);
  }
  return index;
}

function pickNearestDocument(documents: readonly IndexedDocument[], sourceFolder: string | null): IndexedDocument {
  if (!sourceFolder) return documents[0];
  return [...documents].sort((left, right) => {
    const leftScore = getPathProximityScore(left.path, sourceFolder);
    const rightScore = getPathProximityScore(right.path, sourceFolder);
    if (leftScore !== rightScore) return rightScore - leftScore;
    return left.path.localeCompare(right.path);
  })[0];
}

function getPathProximityScore(path: string, sourceFolder: string): number {
  const pathParts = path.split("/");
  const folderParts = sourceFolder.split("/");
  let score = 0;
  while (score < pathParts.length && score < folderParts.length && pathParts[score] === folderParts[score]) {
    score += 1;
  }
  return score;
}

function toIndexedDocument(document: MarkdownLinkGraphDocument): IndexedDocument {
  const normalizedPath = normalizeDataPath(document.path);
  const title = stripKnownFileExtension(document.name || getBaseName(document.path));

  return {
    path: document.path,
    name: document.name,
    title,
    normalizedPath: normalizeLookupKey(normalizedPath),
    normalizedPathWithoutExtension: normalizeLookupKey(stripKnownFileExtension(normalizedPath)),
    content: typeof document.content === "string" ? document.content : null,
  };
}

function getOrCreateMap<K, V>(map: Map<K, Map<string, V>>, key: K): Map<string, V> {
  const existing = map.get(key);
  if (existing) return existing;
  const next = new Map<string, V>();
  map.set(key, next);
  return next;
}

function getDisplayNameFromTarget(target: string): string {
  const parts = splitWikiLinkTarget(target);
  if (parts.targetPath) return stripKnownFileExtension(getBaseName(parts.targetPath));
  return parts.heading ?? target;
}

function normalizeDataPath(path: string): string {
  return normalizeDataResourcePath(path) ?? "";
}

function normalizeLookupKey(value: string): string {
  return normalizeDataPath(value).toLocaleLowerCase();
}

function hasMarkdownExtension(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path);
}

function hasKnownFileExtension(path: string): boolean {
  return /\.[^/.]+$/i.test(getBaseName(path));
}

function stripKnownFileExtension(path: string): string {
  return path.replace(/\.[^/.]+$/i, "");
}

function getBaseName(path: string): string {
  const normalizedPath = normalizeDataPath(path);
  if (!normalizedPath) return "";
  const lastSlash = normalizedPath.lastIndexOf("/");
  return lastSlash === -1 ? normalizedPath : normalizedPath.slice(lastSlash + 1);
}

function getParentPath(path: string | null): string | null {
  if (!path || !path.includes("/")) return null;
  return path.slice(0, path.lastIndexOf("/"));
}

function joinDataPath(folderPath: string, name: string): string {
  return `${folderPath}/${name}`;
}
