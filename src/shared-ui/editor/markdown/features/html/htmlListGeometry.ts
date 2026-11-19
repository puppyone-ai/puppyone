/** Counter width is document geometry, not a theme default. Keep ordered
 * markers aligned through start/reversed/value changes while CSS owns gaps. */
export function prepareHtmlListGeometry(root: HTMLElement) {
  for (const list of root.querySelectorAll<HTMLOListElement>("ol")) {
    const items = [...list.children].filter((node): node is HTMLLIElement => node.tagName === "LI");
    const reversed = list.hasAttribute("reversed"), step = reversed ? -1 : 1;
    let ordinal = reversed ? items.length : 1;
    if (list.hasAttribute("start")) ordinal = list.start;
    let columns = 0;
    for (const item of items) {
      if (item.hasAttribute("value")) ordinal = item.value;
      columns = Math.max(columns, String(ordinal).length + 1);
      ordinal += step;
    }
    list.style.setProperty("--md-list-marker-columns", String(columns));
  }
}
