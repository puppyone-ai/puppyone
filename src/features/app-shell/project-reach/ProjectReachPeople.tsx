import { useRef, useState } from "react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { ReachPanel, type ReachPanelContext } from "./ReachPanel";
import { ReachMemberMark, useReachFreshness, useReachSummary } from "./reachPresentation";
import "./reach-header.css";

/**
 * Who can reach this project, on the right of the Header, where every other
 * application puts the people who are in a document with you.
 *
 * It is the same control as the place on the left and opens the same panel —
 * one subject, two views, never two entries with two answers. The marks are
 * the identities themselves: an agent is its brand, a person is a round
 * initial. Lit means working in the project right now; the rest are quiet.
 *
 * With nobody there it renders nothing at all. An empty slot that said
 * "invite someone" would be a pitch for Cloud on a Header belonging to a user
 * who has never shared anything, which is exactly what this product refuses
 * to do.
 */
export type ProjectReachPeopleProps = ReachPanelContext;

/** Enough faces to recognize the room; the rest are a count. */
const VISIBLE_MEMBER_LIMIT = 3;

export function ProjectReachPeople(context: ProjectReachPeopleProps) {
  const { t } = useLocalization();
  const { state } = context;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const summary = useReachSummary(state);
  const freshness = useReachFreshness(state);
  if (state.members.length === 0) return null;

  // Whoever is working comes first: it is the only live fact in the row.
  const ordered = [...state.members].sort((left, right) => (
    Number(Boolean(right.activity)) - Number(Boolean(left.activity))
  ));
  const visible = ordered.slice(0, VISIBLE_MEMBER_LIMIT);
  const overflow = ordered.length - visible.length;
  return (
    <div className="desktop-titlebar-reach-people-wrap">
      <Tooltip content={freshness}>
        <button
          ref={anchor}
          type="button"
          className="desktop-titlebar-reach-people"
          data-reach-state={state.kind}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={summary}
          onClick={() => setOpen((value) => !value)}
        >
          {visible.map((member) => <ReachMemberMark key={member.id} member={member} />)}
          {overflow > 0 && (
            <span className="desktop-project-reach-count">
              {t("shell.projectReach.more", { count: overflow })}
            </span>
          )}
        </button>
      </Tooltip>
      <ReachPanel anchor={anchor} open={open} onDismiss={() => setOpen(false)} context={context} />
    </div>
  );
}
