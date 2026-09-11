import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useLocalization } from "@puppyone/localization/react";
import { useNativeSurfacePointerRoutingRegion } from "../../../native-surfaces";
import {
  clampWorkbenchRatioToBounds,
  type WorkbenchSplitMinimumSize,
  type WorkbenchSplitRatioBounds,
} from "./workbenchSplitConstraints";
import type { AuxiliaryWorkbenchLayoutSplit } from "@puppyone/shared-ui";
import {
  measureWorkbenchSplitRatioBounds,
  useWorkbenchSplitResizeGesture,
} from "./interactions/useWorkbenchSplitResizeGesture";

export type WorkbenchSplitResizeHandleProps = Readonly<{
  direction: AuxiliaryWorkbenchLayoutSplit["direction"];
  firstMinimum: WorkbenchSplitMinimumSize;
  secondMinimum: WorkbenchSplitMinimumSize;
  ratio: number;
  splitId: string;
  onCommit: (splitId: string, ratio: number) => void;
}>;

const DEFAULT_BOUNDS: WorkbenchSplitRatioBounds = Object.freeze({
  minimum: 0.01,
  maximum: 0.99,
});

export function WorkbenchSplitResizeHandle({
  direction,
  firstMinimum,
  secondMinimum,
  ratio,
  splitId,
  onCommit,
}: WorkbenchSplitResizeHandleProps) {
  const { t } = useLocalization();
  const handleRef = useRef<HTMLDivElement>(null);
  const [hitRegion, setHitRegion] = useState<HTMLSpanElement | null>(null);
  useNativeSurfacePointerRoutingRegion("terminal-split-resize", hitRegion);
  const [bounds, setBounds] = useState(DEFAULT_BOUNDS);
  const gesture = useWorkbenchSplitResizeGesture({
    direction,
    firstMinimum,
    secondMinimum,
    ratio,
    splitId,
    onCommit,
  });

  useLayoutEffect(() => {
    const handle = handleRef.current;
    if (!handle) return undefined;
    const update = () => {
      const next = measureWorkbenchSplitRatioBounds(
        handle,
        direction,
        firstMinimum,
        secondMinimum,
      );
      setBounds((current) => sameBounds(current, next) ? current : next);
    };
    update();
    if (typeof ResizeObserver !== "function" || !handle.parentElement) return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(handle.parentElement);
    return () => observer.disconnect();
  }, [direction, firstMinimum, secondMinimum]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentBounds = measureWorkbenchSplitRatioBounds(
      event.currentTarget,
      direction,
      firstMinimum,
      secondMinimum,
    );
    setBounds(currentBounds);
    const decrementKey = direction === "horizontal" ? "ArrowLeft" : "ArrowUp";
    const incrementKey = direction === "horizontal" ? "ArrowRight" : "ArrowDown";
    let nextRatio: number | null = null;
    if (event.key === decrementKey) nextRatio = ratio - 0.025;
    if (event.key === incrementKey) nextRatio = ratio + 0.025;
    if (event.key === "Home") nextRatio = currentBounds.minimum;
    if (event.key === "End") nextRatio = currentBounds.maximum;
    if (nextRatio === null) return;
    event.preventDefault();
    onCommit(splitId, clampWorkbenchRatioToBounds(nextRatio, currentBounds));
  };

  return (
    <div
      ref={handleRef}
      className="desktop-terminal-splitter"
      data-direction={direction}
      role="separator"
      tabIndex={0}
      aria-label={t("terminal.split.resize")}
      aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
      aria-valuemin={Math.round(bounds.minimum * 100)}
      aria-valuemax={Math.round(bounds.maximum * 100)}
      aria-valuenow={Math.round(clampWorkbenchRatioToBounds(ratio, bounds) * 100)}
      onKeyDown={handleKeyDown}
      onDoubleClick={(event) => {
        const currentBounds = measureWorkbenchSplitRatioBounds(
          event.currentTarget,
          direction,
          firstMinimum,
          secondMinimum,
        );
        setBounds(currentBounds);
        onCommit(splitId, clampWorkbenchRatioToBounds(0.5, currentBounds));
      }}
      onPointerDown={gesture.start}
      onPointerMove={gesture.move}
      onPointerUp={gesture.end}
      onPointerCancel={gesture.cancel}
      onLostPointerCapture={gesture.lostCapture}
    ><span ref={setHitRegion} className="desktop-terminal-splitter-hit-region" aria-hidden="true" /></div>
  );
}

function sameBounds(left: WorkbenchSplitRatioBounds, right: WorkbenchSplitRatioBounds) {
  return left.minimum === right.minimum && left.maximum === right.maximum;
}
