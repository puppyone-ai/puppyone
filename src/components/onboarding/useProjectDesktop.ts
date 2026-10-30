import { useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useDesktopPreference } from "../../preferencesStore";
import type { HomepageDesktopPoint } from "../../preferenceStorage";
import { arrangeDesktop, clampToDesktop, desktopHeight, settleOnDesktop } from "./projectDesktop";

const DRAG_THRESHOLD = 4;

type Press = {
  id: string;
  pointerX: number;
  pointerY: number;
  origin: HomepageDesktopPoint;
  moved: boolean;
};

/** Lets a project be picked up and put down anywhere on the Grid. */
export function useProjectDesktop(ids: readonly string[], disabled: boolean) {
  const saved = useDesktopPreference((state) => state.homepageDesktopPositions);
  const save = useDesktopPreference((state) => state.setHomepageDesktopPositions);
  const points = useMemo(() => arrangeDesktop(ids, saved), [ids, saved]);
  const height = desktopHeight(points);
  const [moving, setMoving] = useState<{ id: string; point: HomepageDesktopPoint } | null>(null);
  const press = useRef<Press | null>(null);
  const suppressClick = useRef(false);

  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    const current = press.current;
    press.current = null;
    if (!current?.moved || !moving) return;
    suppressClick.current = true;
    setMoving(null);
    const others = [...points].filter(([id]) => id !== current.id).map(([, point]) => point);
    // The first move freezes the rest too: from here on, a project being updated
    // must not rearrange what was placed by hand.
    save({
      ...saved,
      ...Object.fromEntries(points),
      [current.id]: settleOnDesktop(moving.point, others, height),
    });
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const tile = (id: string) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      suppressClick.current = false;
      const origin = points.get(id);
      if (disabled || event.button !== 0 || !origin) return;
      press.current = { id, pointerX: event.clientX, pointerY: event.clientY, origin, moved: false };
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const current = press.current;
      if (current?.id !== id) return;
      const dx = event.clientX - current.pointerX;
      const dy = event.clientY - current.pointerY;
      if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!current.moved) event.currentTarget.setPointerCapture?.(event.pointerId);
      current.moved = true;
      setMoving({ id, point: clampToDesktop({ x: current.origin.x + dx, y: current.origin.y + dy }, height) });
    },
    onPointerUp: finish,
    onPointerCancel: () => {
      press.current = null;
      setMoving(null);
    },
    onClickCapture: (event: MouseEvent<HTMLButtonElement>) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  });

  const place = (id: string) => {
    const point = moving?.id === id ? moving.point : points.get(id);
    return point ? { transform: `translate(${point.x}px, ${point.y}px)` } : undefined;
  };

  return { height, movingId: moving?.id ?? null, tile, place };
}
