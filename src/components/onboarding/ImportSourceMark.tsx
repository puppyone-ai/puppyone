import { RENDERER_ASSET_PATHS, resolveRendererPublicAssetUrl } from "@puppyone/shared-ui";
import type { ImportSourceBrand } from "../../features/project-import/importSourceRegistry";

/** Apps a user can bring work in from. "git" is rendered as GitHub + GitLab. */
export type { ImportSourceBrand } from "../../features/project-import/importSourceRegistry";

const BRAND_LABELS: Record<ImportSourceBrand, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  notion: "Notion",
  "google-drive": "Google Drive",
  obsidian: "Obsidian",
  airtable: "Airtable",
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
  return (
    <img
      className={`onboarding-import-mark is-${brand} ${className}`.trim()}
      data-import-brand={brand}
      src={resolveRendererPublicAssetUrl(brand === "google-drive"
        ? RENDERER_ASSET_PATHS.icons.integrations.googleDrive
        : RENDERER_ASSET_PATHS.icons.integrations[brand])}
      alt={decorative ? "" : BRAND_LABELS[brand]}
      draggable={false}
    />
  );
}
