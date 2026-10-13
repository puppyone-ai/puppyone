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
 * The kinds, in the order a user meets them: the agents that have their own
 * machine first, because they are the ones that can work while this Mac is
 * closed, then the products the user talks to.
 */
const REACH_AGENT_KINDS: readonly ShareAgentKind[] = ["cloud-native", "assistant"];

/**
 * The first and only question on the connect screen: which agent. Everything
 * else on that path is about the agent the user names here.
 *
 * A mark and a name, grouped by the one difference that changes the decision:
 * an agent with its own machine reads and changes the project while the user
 * is away, and an assistant reads it while they are talking to it. Stated
 * once per group, that fact is useful; it used to be printed under all six
 * names, where it was only loud.
 *
 * Agents that run on this Mac are deliberately absent. They already read the
 * folder; handing them an address would give them an older copy of what they
 * can see directly, so the only honest thing to do is to say so and stop.
 */
export function ReachAgentChoice({
  selected,
  onSelect,
}: {
  selected: ShareTargetId | null;
  onSelect: (id: ShareTargetId) => void;
}) {
  const { t } = useLocalization();
  const question = t("cloud.share.reach.connect.question");
  const groups = useReachAgentGroups();
  const other = shareAgentsOfKind("other");

  return (
    <div className="desktop-reach-section">
      <p className="desktop-share-question">{question}</p>
      <div className="desktop-reach-agent-groups" role="radiogroup" aria-label={question}>
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
      {/* Where "none of these" leads, and the one question the list's own rule
          raises: a quiet line, not a seventh candidate. */}
      <p className="desktop-reach-agent-exit">
        {other.map((target) => (
          <button
            key={target.id}
            type="button"
            className="desktop-share-inline-link"
            data-share-target={target.id}
            onClick={() => onSelect(target.id)}
          >
            {t(shareTargetLabelKey(target.id))}
          </button>
        ))}
        <span className="desktop-reach-fact">{t("cloud.share.reach.connect.localAgents")}</span>
      </p>
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
 * The kinds that have candidates, each with the agent this Mac last connected
 * first within its own group.
 *
 * The memory holds an id, not a destination: an id the product no longer
 * offers simply does not match, and the groups are the plain ones again.
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
