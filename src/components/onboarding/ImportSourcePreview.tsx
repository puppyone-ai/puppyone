import { ImportSourceMark, type ImportSourceBrand } from "./ImportSourceMark";

export const DEFAULT_IMPORT_PREVIEW_BRANDS: readonly ImportSourceBrand[] = ["github", "gitlab"];

/** Shared compact source preview for every Project Import entry point. */
export function ImportSourcePreview({
  brands = DEFAULT_IMPORT_PREVIEW_BRANDS,
}: {
  brands?: readonly ImportSourceBrand[];
}) {
  return (
    <span className="onboarding-entry-import-source-preview">
      <span className="onboarding-entry-import-brands">
        {brands.map((brand) => (
          <span className="onboarding-entry-import-brand-badge" key={brand}>
            <ImportSourceMark brand={brand} />
          </span>
        ))}
      </span>
    </span>
  );
}
