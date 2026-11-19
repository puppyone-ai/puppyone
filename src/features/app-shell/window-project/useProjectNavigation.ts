import { useEffect, useRef, useState } from "react";
import { ProjectNavigation } from "./projectNavigation";
import { useWindowProject, type ProjectTarget } from "./windowProjectStore";

export function useProjectNavigation(options: {
  open: (target: ProjectTarget, isCurrent: () => boolean) => Promise<void>;
  onError: (error: unknown, target: ProjectTarget) => void;
}) {
  const current = useRef(options);
  current.current = options;
  const [navigation] = useState(() => new ProjectNavigation(
    (target, isCurrent) => current.current.open(target, isCurrent),
    (error, target) => current.current.onError(error, target),
  ));
  const pending = useWindowProject((project) => project.opening);
  useEffect(() => () => navigation.cancel(), [navigation]);
  return { select: navigation.select, cancel: navigation.cancel, pending };
}
