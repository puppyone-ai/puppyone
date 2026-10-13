import { useLocalization } from "@puppyone/localization/react";
import { useMemo } from "react";
import { selectReachLastAgentId, useDesktopPreference } from "../../../../preferencesStore";
import { ShareTargetMark } from "../CloudShareHome";
import { shareTargetLabelKey, type ShareTarget, type ShareTargetId } from "../shareTargets";
import { reachIntentTargets } from "./projectReach";

/**
 * The first and only question on the connect screen: which agent. Everything
 * else on that path is about the agent the user names here.
 *
 * A mark and a name, and nothing else. Whether a destination is awake all the
 * time is true of the destination, not a reason to pick one over another, and
 * printed six times under six names it was the loudest thing on the screen.
 *
 * The answer the user gave last time leads, at the size of an answer; the rest
 * follow as candidates, packed in reading order so the block ends where the
 * names end instead of leaving a hole in a column that ran out of them.
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
  const candidates = useReachAgentOrder();
  return (
    <div className="desktop-reach-section">
      <p className="desktop-share-question">{question}</p>
      <div className="desktop-reach-agents" role="radiogroup" aria-label={question}>
        {candidates.map(({ target, remembered }) => (
          <button
            key={target.id}
            type="button"
            role="radio"
            aria-checked={selected === target.id}
            className={`desktop-reach-agent${remembered ? " is-remembered" : ""}${selected === target.id ? " is-selected" : ""}`}
            data-share-target={target.id}
            onClick={() => onSelect(target.id)}
          >
            <ShareTargetMark target={target} />
            <span className="desktop-reach-agent-name">{t(shareTargetLabelKey(target.id))}</span>
            {remembered && (
              <span className="desktop-reach-agent-note">{t("cloud.share.reach.connect.lastUsed")}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The candidates, with the one this Mac last connected first.
 *
 * The memory holds an id, not a destination: an id the product no longer
 * offers simply does not match, and the list is the plain one again.
 */
function useReachAgentOrder(): readonly { target: ShareTarget; remembered: boolean }[] {
  const lastAgentId = useDesktopPreference(selectReachLastAgentId);
  return useMemo(() => {
    const candidates = reachIntentTargets("connect");
    const remembered = candidates.find((candidate) => candidate.id === lastAgentId) ?? null;
    if (!remembered) return candidates.map((target) => ({ target, remembered: false }));
    return [
      { target: remembered, remembered: true },
      ...candidates
        .filter((candidate) => candidate.id !== remembered.id)
        .map((target) => ({ target, remembered: false })),
    ];
  }, [lastAgentId]);
}
