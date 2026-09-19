import { RENDERER_ASSET_PATHS, resolveRendererPublicAssetUrl } from "@puppyone/shared-ui";

/** Apps a user can bring work in from. "git" is rendered as GitHub + GitLab. */
export type ImportSourceBrand = "github" | "gitlab" | "notion" | "obsidian" | "airtable";

export const IMPORT_SOURCE_BRANDS: ReadonlyArray<ImportSourceBrand> = [
  "github",
  "gitlab",
  "notion",
  "obsidian",
  "airtable",
];

const BRAND_LABELS: Record<ImportSourceBrand, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  notion: "Notion",
  obsidian: "Obsidian",
  airtable: "Airtable",
};

export function getImportSourceBrandLabel(brand: ImportSourceBrand) {
  return BRAND_LABELS[brand];
}

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
  return (
    <img
      className={`onboarding-import-mark is-${brand} ${className}`.trim()}
      data-import-brand={brand}
      src={resolveRendererPublicAssetUrl(RENDERER_ASSET_PATHS.icons.integrations[brand])}
      alt={decorative ? "" : BRAND_LABELS[brand]}
      draggable={false}
    />
  );
}
