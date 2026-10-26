import { useLocalization } from "@puppyone/localization/react";
import { useMemo } from "react";
import { selectReachLastAgentId, useDesktopPreference } from "../../../../preferencesStore";
import { ShareTargetMark } from "../CloudShareHome";
import {
  shareAgentKindKey,
  shareAgentsOfKind,
  shareTargetLabelKey,
  type ShareAgentKind,
  type ShareTarget,
  type ShareTargetId,
} from "../shareTargets";

/**
 * Where the agent is, in the order a user meets them: on its own machine in
 * the cloud, inside a product they talk to, or on a machine somewhere else
 * that they will configure themselves.
 */
const REACH_AGENT_KINDS: readonly ShareAgentKind[] = ["cloud-native", "assistant", "remote-client"];

/**
 * The only question on the connect screen: which agent.
 *
 * It is not asked in words. The dialog's own title already says what is being
 * connected to what, so the screen is the answer sheet: three places an agent
 * can be, and the names found in each. Where it is decides how it is
 * connected, which is why the places are the headings and not a sentence
 * under every name.
 *
 * Agents that run on this Mac have no place here. They read the folder
 * already; an address would only hand them an older copy of what they can
 * see, so the list stays about everything that is somewhere else.
 */
export function ReachAgentChoice({
  selected,
  onSelect,
  compact = false,
}: {
  compact?: boolean;
  selected: ShareTargetId | null;
  onSelect: (id: ShareTargetId) => void;
}) {
  const { t } = useLocalization();
  const groups = useReachAgentGroups();

  return (
    <div
      className={`desktop-reach-agent-groups${compact ? " is-compact" : ""}`}
      role="radiogroup"
      aria-label={t("cloud.share.reach.connect.question")}
    >
      {groups.map((group) => (
        <div className="desktop-reach-agent-group" key={group.kind}>
          <p className="desktop-reach-agent-kind">{t(shareAgentKindKey(group.kind))}</p>
          <div className="desktop-reach-agents">
            {group.candidates.map(({ target, remembered }) => (
              <ReachAgentChip
                key={target.id}
                target={target}
                remembered={remembered}
                selected={selected === target.id}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReachAgentChip({
  target,
  remembered,
  selected,
  onSelect,
}: {
  target: ShareTarget;
  remembered: boolean;
  selected: boolean;
  onSelect: (id: ShareTargetId) => void;
}) {
  const { t } = useLocalization();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`desktop-reach-agent${remembered ? " is-remembered" : ""}${selected ? " is-selected" : ""}`}
      data-share-target={target.id}
      onClick={() => onSelect(target.id)}
    >
      <ShareTargetMark target={target} />
      <span className="desktop-reach-agent-name">{t(shareTargetLabelKey(target.id))}</span>
      {remembered && (
        <span className="desktop-reach-agent-note">{t("cloud.share.reach.connect.lastUsed")}</span>
      )}
    </button>
  );
}

/**
 * The places that have candidates, each with the agent this Mac last
 * connected first within its own place.
 *
 * The memory holds an id, not a destination: an id the product no longer
 * offers simply does not match, and the places are the plain ones again.
 */
function useReachAgentGroups(): readonly {
  kind: ShareAgentKind;
  candidates: readonly { target: ShareTarget; remembered: boolean }[];
}[] {
  const lastAgentId = useDesktopPreference(selectReachLastAgentId);
  return useMemo(() => REACH_AGENT_KINDS
    .map((kind) => {
      const targets = shareAgentsOfKind(kind);
      const remembered = targets.find((target) => target.id === lastAgentId) ?? null;
      const ordered = remembered
        ? [remembered, ...targets.filter((target) => target.id !== remembered.id)]
        : targets;
      return {
        kind,
        candidates: ordered.map((target) => ({ target, remembered: target === remembered })),
      };
    })
    .filter((group) => group.candidates.length > 0), [lastAgentId]);
}
