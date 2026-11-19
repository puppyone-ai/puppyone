export function joinSidebarClassNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
