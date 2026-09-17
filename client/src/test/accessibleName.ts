// Shared helper for the accessibility tests: what counts as a name a screen
// reader can announce.
//
// A name must survive interaction. `aria-label`, `aria-labelledby`, a real
// <label>, or visible text all do. A placeholder does not, because it vanishes
// as soon as the field has content, and a title does not, because support for it
// as a fallback name is inconsistent. Icon-only buttons therefore need an
// explicit `aria-label`.
export function accessibleName(element: Element): string {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) {
    return ariaLabel.trim();
  }

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() || "")
      .join(" ")
      .trim();
    if (text) {
      return text;
    }
  }

  const id = element.getAttribute("id");
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`);
    const text = label?.textContent?.trim();
    if (text) {
      return text;
    }
  }

  const wrappingLabel = element.closest("label");
  const wrappingText = wrappingLabel?.textContent?.trim();
  if (wrappingText) {
    return wrappingText;
  }

  // Only elements whose content is their label. A <select>'s options are not its
  // name, and an <input> has no content to read.
  if (element.tagName === "BUTTON" || element.tagName === "A") {
    return (element.textContent || "").trim();
  }

  return "";
}

/** Interactive controls a screen reader can reach and operate. */
export function visibleControls(root: ParentNode): Element[] {
  return [...root.querySelectorAll("button, input, select, textarea, a[href]")].filter((element) => {
    const html = element as HTMLElement;
    if (element.getAttribute("type") === "hidden" || element.hasAttribute("hidden")) {
      return false;
    }
    if (element.closest('[aria-hidden="true"]')) {
      return false;
    }
    return window.getComputedStyle(html).display !== "none";
  });
}

/** Readable descriptions of the controls in `root` that have no accessible name. */
export function unnamedControls(root: ParentNode): string[] {
  return visibleControls(root)
    .filter((element) => !accessibleName(element))
    .map((element) => {
      const identity =
        element.getAttribute("id") || element.getAttribute("aria-describedby") || element.className || element.tagName;
      return `<${element.tagName.toLowerCase()} ${String(identity).slice(0, 60)}>`;
    });
}
