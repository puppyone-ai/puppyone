import {
  AgentBrandImage,
  AgentMonochromeBrandImage,
  isMonochromeAgentBrandId,
  resolveAgentBrand,
} from "@puppyone/shared-ui";

type AgentBrandMarkProps = {
  iconKey?: string | null;
  label: string;
  kind?: "agent" | "provider";
  appearance?: "brand" | "monochrome";
};

/** Local official product marks; no remote fetches or backend protocol knowledge. */
export function AgentBrandMark({
  iconKey,
  label,
  kind = "agent",
  appearance = "brand",
}: AgentBrandMarkProps) {
  const nativeBrand = resolveAgentBrand({ iconKey, label });
  if (nativeBrand) {
    const monochrome = (appearance === "monochrome" || nativeBrand.id === "chatgpt")
      && isMonochromeAgentBrandId(nativeBrand.id);
    return (
      <span
        className={`desktop-agent-brand-mark is-${nativeBrand.id}${monochrome ? " is-monochrome" : ""}`}
        aria-hidden="true"
      >
        {monochrome
          ? <AgentMonochromeBrandImage brandId={nativeBrand.id} />
          : <AgentBrandImage brandId={nativeBrand.id} />}
      </span>
    );
  }

  const initials = label.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "A";
  return <span className={`desktop-agent-brand-mark is-fallback is-${kind}`} aria-hidden="true">{initials}</span>;
}
