import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ProjectNavigation, type ProjectNavigationTarget } from "./projectNavigation";

export function useProjectNavigation(options: {
  open: (target: ProjectNavigationTarget, isCurrent: () => boolean) => Promise<void>;
  onError: (error: unknown, target: ProjectNavigationTarget) => void;
}) {
  const current = useRef(options);
  current.current = options;
  const [navigation] = useState(() => new ProjectNavigation(
    (target, isCurrent) => current.current.open(target, isCurrent),
    (error, target) => current.current.onError(error, target),
  ));
  const pending = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot);
  useEffect(() => () => navigation.cancel(), [navigation]);
  return { select: navigation.select, cancel: navigation.cancel, pending };
}
