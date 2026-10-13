import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { CloudOff } from "lucide-react";
import { ReachPanel, type ReachPanelContext } from "./ReachPanel";
import { ReachPlaceMark, useReachFreshness, useReachPlaceLabel, useReachSummary } from "./reachPresentation";
import "./reach-header.css";

/**
 * The Header's answer to "where is this project".
 *
 * It says one thing out loud — "This Mac", or the Cloud workspace the project
 * is worked on in — because that is the fact a user needs at a glance and the
 * fact only the Header can give. Who can reach the project is the other half
 * of the subject, and it lives on the right of the Header with the people
 * themselves; a control that carried both was a control doing two jobs in one
 * label.
 *
 * It is still the Cloud entry on the left: inviting a person, connecting an
 * agent and getting a copy onto this device are all actions inside its panel,
 * which is why the right side of the Header needs no share button.
 */
export type ProjectReachControlProps = ReachPanelContext & {
  projectMenuOpen?: boolean;
  onOpen?: () => void;
};

export function ProjectReachControl({
  projectMenuOpen = false,
  onOpen,
  ...context
}: ProjectReachControlProps) {
  const { t } = useLocalization();
  const { state } = context;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (projectMenuOpen) setOpen(false); }, [projectMenuOpen]);

  const summary = useReachSummary(state);
  const place = useReachPlaceLabel(state.place);
  const freshness = useReachFreshness(state);
  return (
    <div className="desktop-titlebar-reach-wrap" data-reach-state={state.kind}>
      <Tooltip content={freshness}>
        <button
          ref={anchor}
          type="button"
          className="desktop-titlebar-reach-button"
          data-reach-state={state.kind}
          data-reach-emphasis={state.emphasis || undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t("shell.projectReach.buttonLabel", { place, reach: summary })}
          onClick={() => { if (!open) onOpen?.(); setOpen((value) => !value); }}
        >
          <ReachPlaceMark place={state.place} className="desktop-titlebar-workspace-mark" size={16} />
          <span className="desktop-project-reach-place-label">{place}</span>
          {/* Reach that needs attention is the one thing the place control
              still carries: with nobody able to reach the project there is
              nothing on the right to carry it instead. */}
          {state.kind === "attention" && (
            <span className="desktop-project-reach-marks" data-reach-audience="attention">
              <CloudOff size={16} strokeWidth={1.65} aria-hidden="true" />
            </span>
          )}
        </button>
      </Tooltip>
      <ReachPanel anchor={anchor} open={open} onDismiss={() => setOpen(false)} context={context} />
    </div>
  );
}
