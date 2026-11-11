import { AgentBrandImage, RENDERER_ASSET_PATHS, resolveRendererPublicAssetUrl } from "@puppyone/shared-ui";
import type { ImportSourceBrand } from "../../features/project-import/importSourceRegistry";
import { CodeXml, Database, Type, type LucideIcon } from "lucide-react";

/** Apps a user can bring work in from. "git" is rendered as GitHub + GitLab. */
export type { ImportSourceBrand } from "../../features/project-import/importSourceRegistry";

const BRAND_LABELS: Record<string, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  notion: "Notion",
  "google-drive": "Google Drive",
  obsidian: "Obsidian",
  airtable: "Airtable",
  vscode: "VS Code",
  cursor: "Cursor",
  typora: "Typora",
};

/** Apps without a bundled mark show a plain glyph rather than a drawn logo. */
const BRAND_GLYPHS: Record<string, LucideIcon> = {
  vscode: CodeXml,
  typora: Type,
};

/**
 * Third-party product mark. Marks are decorative next to their own label, so
 * callers pass `decorative` there and let the text carry the name.
 */
export function ImportSourceMark({
  brand,
  decorative = false,
  className = "",
}: {
  brand: ImportSourceBrand;
  decorative?: boolean;
  className?: string;
}) {
  if (brand === "cursor") {
    return <span
      className={`onboarding-import-mark is-${brand} ${className}`.trim()}
      data-import-brand={brand}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : BRAND_LABELS.cursor}
      aria-hidden={decorative || undefined}
    ><AgentBrandImage brandId="cursor" width="100%" height="100%" /></span>;
  }
  const icons: Record<string, string> = RENDERER_ASSET_PATHS.icons.integrations;
  const assetPath = brand === "google-drive"
    ? icons.googleDrive
    : icons[brand];
  if (!assetPath) {
    const Glyph = BRAND_GLYPHS[brand] ?? Database;
    return <Glyph className={`onboarding-import-mark is-${brand} ${className}`.trim()} data-import-brand={brand} aria-hidden={decorative} />;
  }
  return (
    <img
      className={`onboarding-import-mark is-${brand} ${className}`.trim()}
      data-import-brand={brand}
      src={resolveRendererPublicAssetUrl(assetPath)}
      alt={decorative ? "" : BRAND_LABELS[brand] ?? brand}
      draggable={false}
    />
  );
}
