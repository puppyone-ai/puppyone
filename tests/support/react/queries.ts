/**
 * Finds elements the way a person with a screen reader meets them: by role and
 * accessible name, never by class. A test written this way survives a restyle and
 * fails when a control loses its role or its name.
 *
 * Deliberately small: the roles and naming rules this App's controls use, after
 * the WAI-ARIA accessible name computation, without its rarer corners.
 */

const IMPLICIT_ROLES: ReadonlyArray<[selector: string, role: string]> = [
  ["button, input[type=button], input[type=submit], input[type=reset]", "button"],
  ["a[href]", "link"],
  ["input[type=checkbox]", "checkbox"],
  ["input[type=radio]", "radio"],
  ["input:not([type]), input[type=text], input[type=search], input[type=email], input[type=url], textarea", "textbox"],
  ["select", "combobox"],
  ["option", "option"],
  ["ul, ol", "list"],
  ["li", "listitem"],
  ["dialog", "dialog"],
  ["h1, h2, h3, h4, h5, h6", "heading"],
  ["fieldset", "group"],
  ["section[aria-label], section[aria-labelledby]", "region"],
];

export type RoleQuery = { name?: string | RegExp; checked?: boolean };

/** The element's role: its explicit role, or the one its tag implies. */
export function roleOf(element: Element): string | null {
  const explicit = element.getAttribute("role")?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  return IMPLICIT_ROLES.find(([selector]) => element.matches(selector))?.[1] ?? null;
}

/** What assistive technology announces as the element's name, with bidi isolates and spacing normalised. */
export function accessibleName(element: Element): string {
  return normalize(computeName(element, true));
}

export function queryAllByRole(scope: ParentNode, role: string, query: RoleQuery = {}): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>("*")].filter((element) => roleOf(element) === role
    && !isHidden(element)
    && matchesName(accessibleName(element), query.name)
    && (query.checked === undefined || isChecked(element) === query.checked));
}

export function queryByRole(scope: ParentNode, role: string, query: RoleQuery = {}): HTMLElement | null {
  const found = queryAllByRole(scope, role, query);
  if (found.length > 1) throw new Error(`${found.length} elements with role ${role}${describe(query)}: ${found.map(accessibleName).join(" | ")}`);
  return found[0] ?? null;
}

export function getByRole(scope: ParentNode, role: string, query: RoleQuery = {}): HTMLElement {
  const found = queryByRole(scope, role, query);
  if (!found) {
    const present = queryAllByRole(scope, role).map(accessibleName);
    throw new Error(`No element with role ${role}${describe(query)}. With that role: ${present.length ? present.join(" | ") : "none"}`);
  }
  return found;
}

/** The element's text in reading order, as a screen reader would read through it. */
export function readableText(element: Element): string {
  return normalize(textOf(element));
}

/** Whether a checkbox, radio, switch or checkable menu item is on. */
export function isChecked(element: Element): boolean {
  if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) return element.checked;
  return element.getAttribute("aria-checked") === "true";
}

/** Whether the control refuses interaction, natively or by ARIA. */
export function isDisabled(element: Element): boolean {
  return (element as HTMLButtonElement).disabled === true || element.getAttribute("aria-disabled") === "true";
}

function computeName(element: Element, root: boolean): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (root && labelledBy) {
    return labelledBy.split(/\s+/).map((id) => element.ownerDocument.getElementById(id))
      .filter((label): label is HTMLElement => Boolean(label)).map((label) => computeName(label, false)).join(" ");
  }
  const label = element.getAttribute("aria-label");
  if (label?.trim()) return label;
  if (root && (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) {
    const labels = element.labels ? [...element.labels] : [];
    return labels.map((owner) => textOf(owner, element)).join(" ");
  }
  return textOf(element);
}

/** Text content as read aloud: hidden parts skipped, separate elements kept apart. */
function textOf(element: Element, skip?: Element): string {
  const parts: string[] = [];
  for (const node of element.childNodes) {
    if (node.nodeType === node.TEXT_NODE) parts.push(node.textContent ?? "");
    else if (node instanceof Element && node !== skip && !isHidden(node, element)) {
      parts.push(" ", node.getAttribute("aria-label") ?? textOf(node, skip), " ");
    }
  }
  return parts.join("");
}

function isHidden(element: Element, within?: Element): boolean {
  for (let node: Element | null = element; node && node !== within; node = node.parentElement) {
    if (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("hidden")) return true;
  }
  return false;
}

function normalize(text: string): string {
  return text.replace(/[⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
}

function matchesName(name: string, expected: string | RegExp | undefined): boolean {
  if (expected === undefined) return true;
  return typeof expected === "string" ? name === expected : expected.test(name);
}

function describe(query: RoleQuery): string {
  return [query.name !== undefined && ` named ${String(query.name)}`, query.checked !== undefined && ` checked=${query.checked}`]
    .filter(Boolean).join("");
}
