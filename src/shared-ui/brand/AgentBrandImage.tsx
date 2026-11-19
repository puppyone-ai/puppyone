import type { CSSProperties, ImgHTMLAttributes } from "react";
import { getAgentBrand, type AgentBrandId } from "../core/agentBrandCatalog";
import { resolveRendererPublicAssetUrl } from "../core/rendererPublicAsset";
import "./agent-brand-image.css";

type AgentBrandImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "alt" | "src"> & {
  brandId: AgentBrandId;
};

type AgentBrandImageStyle = CSSProperties & {
  "--po-agent-brand-image-scale": number;
};

/** Theme-aware image renderer backed exclusively by AGENT_BRAND_CATALOG. */
export function AgentBrandImage({ brandId, className = "", ...imageProps }: AgentBrandImageProps) {
  const brand = getAgentBrand(brandId);
  if (!brand) return null;

  const lightSource = resolveRendererPublicAssetUrl(brand.assets.light);
  const darkSource = brand.assets.dark
    ? resolveRendererPublicAssetUrl(brand.assets.dark)
    : lightSource;
  const classes = ["po-agent-brand-image", className].filter(Boolean).join(" ");
  const commonProps = {
    ...imageProps,
    alt: "",
    draggable: false,
    style: {
      ...imageProps.style,
      "--po-agent-brand-image-scale": brand.assetOpticalScale,
    } as AgentBrandImageStyle,
  } as const;

  if (lightSource === darkSource) {
    return <img {...commonProps} className={classes} src={lightSource} />;
  }

  return (
    <>
      <img
        {...commonProps}
        className={classes}
        data-agent-brand-theme="light"
        src={lightSource}
      />
      <img
        {...commonProps}
        className={classes}
        data-agent-brand-theme="dark"
        src={darkSource}
      />
    </>
  );
}
