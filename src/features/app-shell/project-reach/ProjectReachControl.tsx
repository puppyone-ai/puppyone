import { useEffect, useRef, useState } from "react";
import { Tooltip, CloudOffIcon } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import { ReachPanel, type ReachPanelContext } from "./ReachPanel";
import type { ProjectPlaceMenuProps } from "../project-place/ProjectPlaceMenu";
import { ReachPlaceMark, useReachFreshness, useReachPlaceLabel, useReachSummary } from "./reachPresentation";
import "./reach-header.css";

/** The Header names where the open project is. Its menu also exposes sharing. */
export type ProjectReachControlProps = ReachPanelContext & {
  projectMenuOpen?: boolean;
  onOpen?: () => void;
  /** Where the open project is and the one action that applies, inside the same panel. */
  placeMenu?: ProjectPlaceMenuProps | null;
};

export function ProjectReachControl({
  projectMenuOpen = false,
  onOpen,
  placeMenu,
  ...context
}: ProjectReachControlProps) {
  const { t } = useLocalization();
  const { state } = context;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (projectMenuOpen) setOpen(false); }, [projectMenuOpen]);

  const summary = useReachSummary(state);
  const placeLabel = useReachPlaceLabel(state.place);
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
          aria-label={t("shell.projectReach.buttonLabel", { place: placeLabel, reach: summary })}
          onClick={() => { if (!open) onOpen?.(); setOpen((value) => !value); }}
        >
          <ReachPlaceMark place={state.place} className="desktop-titlebar-workspace-mark" size={16} />
          <span className="desktop-project-reach-place-label">{placeLabel}</span>
          {/* Reach that needs attention is the one thing the place control
              still carries: with nobody able to reach the project there is
              nothing on the right to carry it instead. */}
          {state.kind === "attention" && (
            <span className="desktop-project-reach-marks" data-reach-audience="attention">
              <CloudOffIcon size={16} strokeWidth={1.65} aria-hidden="true" />
            </span>
          )}
        </button>
      </Tooltip>
      <ReachPanel anchor={anchor} open={open} onDismiss={() => setOpen(false)} context={context} placeMenu={placeMenu} />
    </div>
  );
}
