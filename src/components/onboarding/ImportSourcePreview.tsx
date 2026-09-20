import { ImportSourceMark } from "./ImportSourceMark";

export const IMPORT_PREVIEW_BRANDS = ["github", "notion", "google-drive"] as const;

/** Shared compact source preview for every Project Import entry point. */
export function ImportSourcePreview() {
  return (
    <span className="onboarding-entry-import-source-preview">
      <span className="onboarding-entry-import-brands">
        {IMPORT_PREVIEW_BRANDS.map((brand) => (
          <span className="onboarding-entry-import-brand-badge" key={brand}>
            <ImportSourceMark brand={brand} />
          </span>
        ))}
      </span>
    </span>
  );
}
