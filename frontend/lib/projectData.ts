export type ProjectTableJSON = unknown;

export async function fetchProjectTableData(projectId: string, tableId: string): Promise<ProjectTableJSON | undefined> {
  try {
    const res = await fetch(`/data/projects/${projectId}/${tableId}.json`, { cache: 'no-store' });
    if (!res.ok) return undefined;
    const data = (await res.json()) as ProjectTableJSON;
    return data;
  } catch {
    return undefined;
  }
}

export async function fetchProjectTablesData(
  projectId: string,
  tableIds: string[],
): Promise<Record<string, ProjectTableJSON | undefined>> {
  const entries = await Promise.all(
    tableIds.map(async (id) => [id, await fetchProjectTableData(projectId, id)] as const),
  );
  return Object.fromEntries(entries);
}


