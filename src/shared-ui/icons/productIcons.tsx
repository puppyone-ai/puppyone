import { forwardRef, useId, type ComponentPropsWithoutRef } from "react";
import { createLucideIcon, FolderClosed, Laptop, type LucideIcon, type LucideProps } from "lucide-react";

/**
 * Product icons: one drawing per product meaning.
 *
 * Surfaces ask for a meaning ("a folder", "on this computer", "in the Cloud"),
 * never for a concrete drawing, so a meaning looks the same everywhere and is
 * redrawn here only. The product icon architecture test rejects direct
 * lucide-react imports of these drawings anywhere else.
 */
export type ProductIconMeaning =
  | "home"
  | "folder"
  | "local"
  | "cloud"
  | "cloud-upload"
  | "cloud-off"
  | "disclosure";

/**
 * Geometry of the product folder (lucide FolderClosed). The file-tree folder
 * glyph draws these same paths so the tree and every other folder agree.
 */
export const FOLDER_ICON_PATHS = [
  "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
  "M2 10h20",
] as const;

function meaningIcon(Icon: LucideIcon, meaning: ProductIconMeaning, displayName: string): LucideIcon {
  const MeaningIcon = forwardRef<SVGSVGElement, Omit<LucideProps, "ref">>((props, ref) => (
    <Icon ref={ref} data-product-icon={meaning} {...props} />
  ));
  MeaningIcon.displayName = displayName;
  return MeaningIcon;
}

/** A folder, as content or as the target of an action: the hollow closed folder. */
export const FolderIcon = meaningIcon(FolderClosed, "folder", "FolderIcon");

/** Anything on this computer (local projects, local copies, local models): the hollow laptop. */
export const LocalIcon = meaningIcon(Laptop, "local", "LocalIcon");

/**
 * The product home: a pitched roof over two walls with the door cut into the
 * base line, so each door post runs straight down into the ground instead of
 * closing a threshold beneath the door. Drawn by PuppyOne on lucide's house
 * grid (walls at x3 and x21, base at y21, a 6-wide door rising to y12) as one
 * continuous outline, so it strokes exactly like the laptop and folder.
 */
export const HOME_ICON_PATH = "M15 21h4a2 2 0 0 0 2-2v-9a2 2 0 0 0-.709-1.528l-7-6a2 2 0 0 0-2.582 0l-7 6A2 2 0 0 0 3 10v9a2 2 0 0 0 2 2h4v-8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1z";

const HomeDrawing = createLucideIcon("puppyone-home", [["path", { d: HOME_ICON_PATH, key: "home-outline" }]]);

/**
 * Optical weight of the house beside the laptop. At one stroke width the two
 * outlines carry the same ink (measured 232 vs 231 at 16px / 1.65, 2x), but the
 * house spreads it over ~22% more area, so it reads lighter. A 10% heavier line
 * balances them while the line itself still looks the same thickness, so
 * callers pass the laptop's stroke width and get an equal-weight house.
 */
const HOME_OPTICAL_STROKE_SCALE = 1.1;

/** Home, the page every Project opens from and returns to: the open-door house. */
export const HomeIcon: LucideIcon = forwardRef<SVGSVGElement, Omit<LucideProps, "ref">>(
  ({ strokeWidth = 2, ...props }, ref) => (
    <HomeDrawing ref={ref} data-product-icon="home" {...props}
      strokeWidth={Number((Number(strokeWidth) * HOME_OPTICAL_STROKE_SCALE).toFixed(3))} />
  ),
);
HomeIcon.displayName = "HomeIcon";

/**
 * The product cloud: a dome resting on two equal shoulders over a flat base,
 * with a soft concave blend where each shoulder meets the dome. Drawn by
 * PuppyOne from three circles on the 24px grid (dome r5 at 12,10.4; shoulders
 * r3.8 at 6.8,15.2 and 17.2,15.2; blends r1.4), stroked like the folder and
 * laptop so the three place marks share one line weight.
 */
export const CLOUD_ICON_PATH = "M6.8 19A3.8 3.8 0 1 1 5.927 11.502A1.4 1.4 0 0 0 7.004 10.196A5 5 0 1 1 16.996 10.196A1.4 1.4 0 0 0 18.073 11.502A3.8 3.8 0 1 1 17.2 19Z";

type CloudGlyphProps = Omit<ComponentPropsWithoutRef<"svg">, "height" | "width" | "strokeWidth"> & {
  size?: number | string;
  strokeWidth?: number;
};

type CloudIconProps = CloudGlyphProps & {
  backplate?: boolean;
};

function CloudSvg({ size = 24, strokeWidth = 2, className = "", meaning, children, ...props }: CloudGlyphProps & {
  meaning: ProductIconMeaning;
}) {
  return <svg {...props} className={`desktop-cloud-icon ${className}`.trim()}
    width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    focusable="false" aria-hidden={props["aria-label"] ? undefined : (props["aria-hidden"] ?? true)}
    data-cloud-icon="puppyone" data-product-icon={meaning}>
    {/* Owning the fill here keeps container CSS from filling the outline. */}
    <g fill="none">{children}</g>
  </svg>;
}

/** The Cloud: the product cloud. Context owns color and activation, not the SVG. */
export function CloudIcon({ backplate = false, ...props }: CloudIconProps) {
  return <CloudSvg {...props} meaning="cloud">
    {/* A linked badge hides whatever it overlaps inside its own silhouette. */}
    {backplate && <path d={CLOUD_ICON_PATH} fill="var(--po-surface)" stroke="none" data-cloud-backplate="true" />}
    <path d={CLOUD_ICON_PATH} data-cloud-outline="true" />
  </CloudSvg>;
}

/** Sending to the Cloud: the product cloud carrying an upward arrow. */
export function CloudUploadIcon(props: CloudGlyphProps) {
  return <CloudSvg {...props} meaning="cloud-upload">
    <path d={CLOUD_ICON_PATH} data-cloud-outline="true" />
    <path d="M12 16v-5.25M9.75 13 12 10.75 14.25 13" data-cloud-mark="upload" />
  </CloudSvg>;
}

/** The Cloud is unreachable: the product cloud struck through, with a gap around the stroke. */
export function CloudOffIcon({ strokeWidth = 2, ...props }: CloudGlyphProps) {
  const maskId = `po-cloud-off-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const slash = "M3 3l18 18";
  return <CloudSvg {...props} strokeWidth={strokeWidth} meaning="cloud-off">
    <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
      <rect width="24" height="24" fill="white" stroke="none" />
      <path d={slash} stroke="black" strokeWidth={strokeWidth * 3} />
    </mask>
    <path d={CLOUD_ICON_PATH} mask={`url(#${maskId})`} data-cloud-outline="true" />
    <path d={slash} data-cloud-mark="off" />
  </CloudSvg>;
}

// The disclosure chevron keeps one drawn size and line weight in CSS pixels
// whatever layout box a row gives it: 7px tall, 3.5px deep, a 1.25px line.
const DISCLOSURE_ARM_PX = 3.5;
const DISCLOSURE_STROKE_PX = 1.25;
const roundUnit = (value: number) => Number(value.toFixed(3));

type DisclosureIconProps = Omit<ComponentPropsWithoutRef<"svg">, "width" | "height"> & {
  /**
   * Rows that own their state pass it: collapsed points along the reading
   * direction, expanded points down. Native `<details>` leave it unset and
   * rotate the arrow from CSS on `[open]`.
   */
  expanded?: boolean;
  /** The layout box. The chevron drawn inside it is the same in every box. */
  size?: number;
};

/** Expand and collapse in place: one chevron for every tree, group and details row. */
export function DisclosureIcon({ expanded, size = 12, className = "", style, ...props }: DisclosureIconProps) {
  const unit = 24 / size;
  const arm = DISCLOSURE_ARM_PX * unit;
  const back = roundUnit(12 - arm / 2);
  const tip = roundUnit(12 + arm / 2);
  return <svg {...props}
    className={`po-disclosure-icon${expanded ? " expanded" : ""}${className ? ` ${className}` : ""}`}
    width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={roundUnit(DISCLOSURE_STROKE_PX * unit)} strokeLinecap="round" strokeLinejoin="round"
    focusable="false" aria-hidden={props["aria-label"] ? undefined : (props["aria-hidden"] ?? true)}
    data-product-icon="disclosure" data-expanded={expanded === undefined ? undefined : String(expanded)}
    style={expanded ? { ...style, transform: "rotate(90deg)" } : style}>
    <path d={`M${back} ${roundUnit(12 - arm)}L${tip} 12L${back} ${roundUnit(12 + arm)}`} />
  </svg>;
}

/** The registry: every product meaning and the one drawing that states it. */
export const PRODUCT_ICONS = {
  home: HomeIcon,
  folder: FolderIcon,
  local: LocalIcon,
  cloud: CloudIcon,
  "cloud-upload": CloudUploadIcon,
  "cloud-off": CloudOffIcon,
  disclosure: DisclosureIcon,
} as const satisfies Record<ProductIconMeaning, unknown>;
