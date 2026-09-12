import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DataNode } from "../../../packages/shared-ui/src/core/types";
import type { MarkdownLinkGraphDocument } from "../../../packages/shared-ui/src/editor/markdown/core/links/markdownLinkGraph";

const EXCLUDED_REPOSITORY_DIRECTORIES = new Set([
  ".git",
  "archive",
  "coverage",
  "dist",
  "node_modules",
  "release",
]);

export function makeMarkdown(lineCount: number): string {
  const lines: string[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    if (index % 40 === 0) lines.push(`# Heading ${index}`);
    else if (index % 40 === 1) lines.push("| Name | Value |");
    else if (index % 40 === 2) lines.push("| --- | ---: |");
    else if (index % 40 === 3) lines.push(`| row ${index} | ${index} |`);
    else if (index % 17 === 0) lines.push(`- [ ] Task ${index} with [[Note ${index % 30}]]`);
    else lines.push(`Paragraph ${index} with **bold**, _emphasis_, [link](note-${index % 30}.md), and \`code\`.`);
  }
  return lines.join("\n");
}

export function makeFeatureHeavyMarkdown(sectionCount: number): string {
  const sections: string[] = [];
  for (let index = 0; index < sectionCount; index += 1) {
    sections.push(
      `## Feature section ${index}`,
      "| Name | Value | Status |",
      "| --- | ---: | --- |",
      `| row ${index} | ${index} | **ready** |`,
      "",
      "```mermaid",
      "flowchart LR",
      `  A${index}[Source] --> B${index}[Projection]`,
      "```",
      "",
      `<section data-index="${index}"><strong>Trusted text ${index}</strong></section>`,
      "",
      `Paragraph with ![asset](image-${index}.png), [[Note ${index}]], and [link](note-${index}.md).`,
      "",
    );
  }
  return sections.join("\n");
}

export function makeExplorerNodes(count: number): DataNode[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `node-${index}`,
    name: `document-${index}.md`,
    path: `document-${index}.md`,
    type: "markdown",
    preview: `Preview for document ${index}`,
  }));
}

export function makeLinkGraphDocuments(
  documentCount: number,
  linesPerDocument: number,
): MarkdownLinkGraphDocument[] {
  const content = makeMarkdown(linesPerDocument);
  return Array.from({ length: documentCount }, (_, index) => ({
    path: `folder/note-${index}.md`,
    name: `note-${index}.md`,
    content,
  }));
}

export function readRepositoryMarkdownCorpus(
  root = process.cwd(),
): MarkdownLinkGraphDocument[] {
  return collectMarkdownPaths(root)
    .map((absolutePath) => ({
      path: path.relative(root, absolutePath).split(path.sep).join("/"),
      name: path.basename(absolutePath),
      content: readFileSync(absolutePath, "utf8"),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function readRepositoryTextFile(relativePath: string, root = process.cwd()): string {
  return readFileSync(path.resolve(root, relativePath), "utf8");
}

function collectMarkdownPaths(folder: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_REPOSITORY_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = path.join(folder, entry.name);
    if (entry.isDirectory()) results.push(...collectMarkdownPaths(absolutePath));
    else if (/\.(?:md|markdown)$/i.test(entry.name)) results.push(absolutePath);
  }
  return results;
}
