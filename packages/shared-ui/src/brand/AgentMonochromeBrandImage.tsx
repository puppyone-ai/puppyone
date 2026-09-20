import { useId, type SVGProps } from "react";
import { getAgentBrand, type AgentBrandId } from "../core/agentBrandCatalog";
import { resolveRendererPublicAssetUrl } from "../core/rendererPublicAsset";

export const MONOCHROME_AGENT_BRAND_IDS = Object.freeze([
  "chatgpt",
  "claude",
  "codex",
  "cursor",
  "pi",
] as const);

export type MonochromeAgentBrandId = (typeof MONOCHROME_AGENT_BRAND_IDS)[number];

type AgentMonochromeBrandImageProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  brandId: MonochromeAgentBrandId;
};

export function isMonochromeAgentBrandId(
  brandId: AgentBrandId,
): brandId is MonochromeAgentBrandId {
  return MONOCHROME_AGENT_BRAND_IDS.some((candidate) => candidate === brandId);
}

/** Single-color official marks that inherit the product surface's current text color. */
export function AgentMonochromeBrandImage({
  brandId,
  className = "",
  ...svgProps
}: AgentMonochromeBrandImageProps) {
  const maskId = `po-chatgpt-mark-${useId().replaceAll(":", "")}`;
  const classes = ["po-agent-monochrome-brand-image", className].filter(Boolean).join(" ");
  const commonProps = {
    ...svgProps,
    "aria-hidden": true,
    className: classes,
    fill: "currentColor",
    focusable: "false",
    preserveAspectRatio: "xMidYMid meet",
  } as const;

  if (brandId === "chatgpt") {
    const source = resolveRendererPublicAssetUrl(getAgentBrand("chatgpt")!.assets.light);
    return (
      <svg {...commonProps} viewBox="250 250 1906 1906">
        <mask
          id={maskId}
          x="0"
          y="0"
          width="2406"
          height="2406"
          maskUnits="userSpaceOnUse"
          style={{ maskType: "alpha" }}
        >
          <image href={source} width="2406" height="2406" />
        </mask>
        <rect width="2406" height="2406" mask={`url(#${maskId})`} />
      </svg>
    );
  }

  if (brandId === "codex") {
    return (
      <svg {...commonProps} viewBox="0 0 24 24">
        <path
          clipRule="evenodd"
          fillRule="evenodd"
          d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z"
        />
      </svg>
    );
  }

  if (brandId === "cursor") {
    return (
      <svg {...commonProps} viewBox="0 0 466.73 532.09">
        <path d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z" />
      </svg>
    );
  }

  if (brandId === "pi") {
    // The official 800px asset has a 165px safety area. Keep only a small
    // optical margin so the mark matches the other monochrome identities.
    return (
      <svg {...commonProps} viewBox="150 150 500 500">
        <path
          clipRule="evenodd"
          fillRule="evenodd"
          d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
        />
        <path d="M517.36 400H634.72V634.72H517.36Z" />
      </svg>
    );
  }

  return (
    <svg {...commonProps} viewBox="0 0 24 24">
      <path
        clipRule="evenodd"
        fillRule="evenodd"
        d="m4.709 15.955 4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 0 1-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
      />
    </svg>
  );
}
