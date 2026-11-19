import { useLocalization } from "@puppyone/localization";
import type { CloudSpace } from "../../../lib/workspaceHomeModel";
import { spaceDisplayName, spaceMarkInitial, spaceMarkTone, spacePlanKey } from "./spacePresentation";
import "./space-mark.css";

/**
 * A Space is a rounded square everywhere it appears: the Header, the project
 * menu, the Homepage and Settings. A person is a circle and a computer is a
 * line icon, so the shape alone says which kind of thing is named.
 */
export function SpaceMark({ space, size = "md", className }: {
  space: Pick<CloudSpace, "id" | "name">;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return <span className={className ? `po-space-mark ${className}` : "po-space-mark"} data-size={size}
    data-tone={spaceMarkTone(space.id)} aria-hidden="true">{spaceMarkInitial(space.name)}</span>;
}

/** The plan beside a Space's name: where a project lives says who pays for it. */
export function SpacePlanBadge({ planId, className }: { planId: string | null | undefined; className?: string }) {
  const { t } = useLocalization();
  if (!planId) return null;
  const plan = spacePlanKey(planId);
  return <span className={className ? `po-space-plan ${className}` : "po-space-plan"} data-plan={plan}>
    {t(`onboarding.spaces.plan.${plan}`)}
  </span>;
}

export function useSpaceName() {
  const { t } = useLocalization();
  const personal = t("settings.space.personal");
  return (space: Pick<CloudSpace, "name" | "isDefault">) => spaceDisplayName(space, personal);
}
