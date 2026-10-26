import type { ComponentPropsWithoutRef } from "react";

// Ant Design CloudOutlined, MIT (Ant UED). Original outline, not a redrawn logo.
// Source: ant-design/ant-design-icons@7f2516ac91226d2b41f93b35cb5197c8d94f7189
// packages/icons-svg/svg/outlined/cloud.svg
// License: public/assets/icons/cloud/ant-design-license.txt
const outline = "M811.4 418.7C765.6 297.9 648.9 212 512.2 212S258.8 297.8 213 418.6C127.3 441.1 64 519.1 64 612c0 110.5 89.5 200 199.9 200h496.2C870.5 812 960 722.5 960 612c0-92.7-63.1-170.7-148.6-193.3zm36.3 281a123.07 123.07 0 0 1-87.6 36.3H263.9c-33.1 0-64.2-12.9-87.6-36.3A123.3 123.3 0 0 1 140 612c0-28 9.1-54.3 26.2-76.3a125.7 125.7 0 0 1 66.1-43.7l37.9-9.9 13.9-36.6c8.6-22.8 20.6-44.1 35.7-63.4a245.6 245.6 0 0 1 52.4-49.9c41.1-28.9 89.5-44.2 140-44.2s98.9 15.3 140 44.2c19.9 14 37.5 30.8 52.4 49.9 15.1 19.3 27.1 40.7 35.7 63.4l13.8 36.5 37.8 10c54.3 14.5 92.1 63.8 92.1 120 0 33.1-12.9 64.3-36.3 87.7z";
// Reuse the original outer contour to obscure the folder behind a linked badge.
const outerContour = outline.slice(0, outline.indexOf("zm")) + "z";

type CloudIconProps = Omit<ComponentPropsWithoutRef<"svg">, "height" | "width"> & {
  size?: number | string;
  backplate?: boolean;
};

/** Shared Cloud identity glyph. Context owns color and activation, not the SVG. */
export function CloudIcon({ size = 24, backplate = false, className = "", ...props }: CloudIconProps) {
  return <svg {...props} className={`desktop-cloud-icon ${className}`.trim()}
    width={size} height={size} viewBox="0 0 1024 1024" fill="none" stroke="none"
    focusable="false" aria-hidden={props["aria-label"] ? undefined : (props["aria-hidden"] ?? true)}
    data-cloud-icon="ant-design">
    {backplate && <path d={outerContour} fill="var(--po-surface)" data-cloud-backplate="true" />}
    <path d={outline} fill="currentColor" data-cloud-outline="true" />
  </svg>;
}
