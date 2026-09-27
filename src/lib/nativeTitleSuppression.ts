function preserveAccessibleName(element: Element, title: string) {
  if (
    !title
    || element.hasAttribute("aria-label")
    || element.hasAttribute("aria-labelledby")
  ) return;

  const tagName = element.tagName.toLowerCase();
  const isFrame = tagName === "iframe";
  const isUnlabelledControl = element.matches("button, input, select, textarea, [role='button']")
    && !element.textContent?.trim();
  if (isFrame || isUnlabelledControl) element.setAttribute("aria-label", title);
}

function suppressNativeTitle(element: Element) {
  const title = element.getAttribute("title");
  if (title === null) return;
  preserveAccessibleName(element, title.trim());
  element.removeAttribute("title");
}

function suppressSvgTitle(element: Element) {
  if (element.tagName.toLowerCase() !== "title") return;
  const svg = element.closest("svg");
  if (!svg) return;

  const title = element.textContent?.trim() ?? "";
  if (title && !svg.hasAttribute("aria-label") && !svg.hasAttribute("aria-labelledby")) {
    svg.setAttribute("aria-label", title);
  }
  element.remove();
}

function suppressNativeTitlesIn(node: Node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as Element;
  suppressNativeTitle(element);
  suppressSvgTitle(element);
  element.querySelectorAll("[title]").forEach(suppressNativeTitle);
  element.querySelectorAll("svg title").forEach(suppressSvgTitle);
}

/**
 * Native browser title bubbles are not part of the product tooltip system.
 * Keep this guard active for third-party and imperative DOM that bypasses JSX.
 */
export function installNativeTitleSuppression(documentRoot: Document = document) {
  suppressNativeTitlesIn(documentRoot.documentElement);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        suppressNativeTitle(record.target as Element);
        continue;
      }
      record.addedNodes.forEach(suppressNativeTitlesIn);
    }
  });
  observer.observe(documentRoot.documentElement, {
    attributes: true,
    attributeFilter: ["title"],
    childList: true,
    subtree: true,
  });
  return () => observer.disconnect();
}
