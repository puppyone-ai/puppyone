export const SIDEBAR_VIRTUALIZATION_THRESHOLD = 200;
export const SIDEBAR_VIRTUALIZATION_MAX_MOUNTED_ROWS = 120;

export function shouldVirtualizeSidebarList(itemCount: number) {
  return itemCount > SIDEBAR_VIRTUALIZATION_THRESHOLD;
}
