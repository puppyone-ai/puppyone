import type { ProjectInfo } from './projectsApi';

const DEFAULT_PROJECT_NAME = 'Untitled Project';
const DEFAULT_PROJECT_NAME_RE = /^Untitled Project(?: (?:(\d+)|\((\d+)\)))?$/i;

function untitledProjectSlot(name: string) {
  const match = name.trim().match(DEFAULT_PROJECT_NAME_RE);
  if (!match) return null;

  const rawIndex = match[1] ?? match[2];
  if (rawIndex === undefined) return 1;

  const index = Number(rawIndex);
  return Number.isInteger(index) && index > 1 ? index : null;
}

export function nextUntitledProjectName(projects: readonly Pick<ProjectInfo, 'name'>[]) {
  const occupied = new Set<number>();

  for (const project of projects) {
    const slot = untitledProjectSlot(project.name);
    if (slot !== null) occupied.add(slot);
  }

  let nextIndex = 1;
  while (occupied.has(nextIndex)) {
    nextIndex += 1;
  }

  return nextIndex === 1 ? DEFAULT_PROJECT_NAME : `${DEFAULT_PROJECT_NAME} ${nextIndex}`;
}
