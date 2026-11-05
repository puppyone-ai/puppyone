import {
  AgentBrandImage,
  AgentMonochromeBrandImage,
  getAgentBrand,
  isMonochromeAgentBrandId,
  resolveAgentBrand,
} from "@puppyone/shared-ui";
import { AgentCreature } from "./AgentCreature";
import "./agent-avatar.css";

/** One Agent's chosen brand or its own creature, independent of any Share flow. */
export function AgentAvatarMark({ name, avatar, active, size = 18 }: {
  name: string;
  avatar?: string | null;
  active: boolean;
  size?: number | string;
}) {
  const brand = avatar === "other" ? null : getAgentBrand(avatar) ?? resolveAgentBrand({ label: name });
  let drawing = <AgentCreature seed={name} awake={active} />;
  if (brand) drawing = isMonochromeAgentBrandId(brand.id)
    ? <AgentMonochromeBrandImage brandId={brand.id} /> : <AgentBrandImage brandId={brand.id} />;
  return <span className="desktop-project-reach-mark" data-reach-audience="machine"
    data-reach-activity={active ? "working" : undefined} data-reach-brand={brand?.id}
    data-reach-creature={!brand ? "" : undefined} style={{ width: size, height: size }} aria-hidden="true">
    {drawing}
  </span>;
}
