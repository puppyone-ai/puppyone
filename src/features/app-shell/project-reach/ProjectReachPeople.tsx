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
 * the identities themselves: an agent is its brand, a person is an initial,
 * both round. Lit means working in the project right now.
 *
 * With nobody there it renders nothing at all. An empty slot that said
 * "invite someone" would be a pitch for Cloud on a Header belonging to a user
 * who has never shared anything, which is exactly what this product refuses
 * to do.
 */
export type ProjectReachPeopleProps = ReachPanelContext & {
  /** Where another surface already owns the list, the marks go there instead of to the panel. */
  onOpen?: () => void;
  /** Where the members work in the project rather than read it, "sees your version" is not true. */
  statement?: string;
  /** In a hosted workspace the person looking is one of those in it, even alone. */
  viewer?: string;
};

/** Enough faces to recognize the room; the rest are a count. */
const VISIBLE_MEMBER_LIMIT = 3;
/** The account mark's size, so an identity is the same object everywhere. */
const MARK_SIZE = 22;

export function ProjectReachPeople({ onOpen, statement, viewer, ...context }: ProjectReachPeopleProps) {
  const { t } = useLocalization();
  const { state } = context;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const summary = useReachSummary(state);
  const freshness = useReachFreshness(state);
  if (state.members.length === 0 && !viewer) return null;

  // Whoever is working comes first: it is the only live fact in the row.
  const ordered = [...state.members].sort((left, right) => (
    Number(Boolean(right.activity)) - Number(Boolean(left.activity))
  ));
  const visible = ordered.slice(0, VISIBLE_MEMBER_LIMIT);
  const overflow = ordered.length - visible.length;
  return (
    <div className="desktop-titlebar-reach-people-wrap">
      <Tooltip content={statement ?? freshness}>
        <button
          ref={anchor}
          type="button"
          className="desktop-titlebar-reach-people"
          data-reach-state={state.kind}
          aria-haspopup="dialog"
          aria-expanded={onOpen ? undefined : open}
          aria-label={statement ?? summary}
          onClick={onOpen ?? (() => setOpen((value) => !value))}
        >
          {visible.map((member) => <ReachMemberMark key={member.id} member={member} size={MARK_SIZE} />)}
          {overflow > 0 && (
            <span className="desktop-project-reach-count">
              {t("shell.projectReach.more", { count: overflow })}
            </span>
          )}
          {/* Last, beside Share: others come and go without moving the person looking. */}
          {viewer && <ReachMemberMark viewer size={MARK_SIZE} member={{ id: "viewer", name: viewer,
            audience: "person", lastSeenAt: null, activity: null }} />}
        </button>
      </Tooltip>
      <ReachPanel anchor={anchor} open={open} onDismiss={() => setOpen(false)} context={context} />
    </div>
  );
}
