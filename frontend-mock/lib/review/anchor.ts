"use client";

/**
 * Turning a click into something we can find again later.
 *
 * Storing raw x/y would break the moment the layout reflows — a different
 * window width, a table with one more row, a collapsed section. Instead each
 * pin remembers the element it was dropped on (as a CSS path) plus where
 * inside that element's box the click landed. On the way back we re-query the
 * element and place the dot at the same relative spot, whatever size it is
 * now. Document coordinates are kept as a last-resort fallback.
 */

/** Marks our own UI so a pin can never be anchored to the review layer. */
export const REVIEW_UI_ATTR = "data-review-ui";

function isReviewUi(el: Element | null): boolean {
  return !!el?.closest?.(`[${REVIEW_UI_ATTR}]`);
}

/** An id we generated ourselves is not stable across renders — ignore those. */
function usableId(id: string): boolean {
  return (
    !!id &&
    id.length < 60 &&
    !/^(radix|headlessui|react|:r|«)/i.test(id) &&
    /^[A-Za-z][\w-]*$/.test(id)
  );
}

function nthOfType(el: Element): number {
  let n = 1;
  let sib = el.previousElementSibling;
  while (sib) {
    if (sib.tagName === el.tagName) n += 1;
    sib = sib.previousElementSibling;
  }
  return n;
}

/**
 * Build a CSS path from `<body>` down to the element.
 *
 * Stops early on a usable id, which keeps the selector short and makes it
 * survive changes higher up the tree.
 */
export function buildSelector(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;

  while (node && node.nodeType === 1 && node !== document.body) {
    if (usableId(node.id)) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      return parts.join(" > ");
    }
    const tag = node.tagName.toLowerCase();
    parts.unshift(`${tag}:nth-of-type(${nthOfType(node)})`);
    node = node.parentElement;
    if (parts.length > 12) break; // deep enough; the fallback covers the rest
  }
  return ["body", ...parts].join(" > ");
}

export function resolveAnchor(selector: string): HTMLElement | null {
  try {
    const el = document.querySelector(selector);
    return el instanceof HTMLElement && !isReviewUi(el) ? el : null;
  } catch {
    return null;
  }
}

/** A short human description, used in the list and when the anchor is gone. */
export function describe(el: Element): string {
  const aria = el.getAttribute("aria-label");
  const text = (aria || (el as HTMLElement).innerText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
  const tag = el.tagName.toLowerCase();
  const kind =
    tag === "button" || el.getAttribute("role") === "button"
      ? "Button"
      : tag === "a"
        ? "Link"
        : /^h[1-6]$/.test(tag)
          ? "Heading"
          : tag === "th" || tag === "td"
            ? "Table cell"
            : tag === "input" || tag === "textarea" || tag === "select"
              ? "Field"
              : tag === "img" || tag === "svg"
                ? "Image"
                : "Section";
  return text ? `${kind} · ${text}` : kind;
}

/**
 * Pick the element a click should attach to.
 *
 * The deepest hit element is often a decorative `<span>` or an icon path, so
 * climb until the box is big enough to be a meaningful target while staying
 * as specific as possible.
 */
export function anchorFromPoint(
  clientX: number,
  clientY: number
): { el: HTMLElement; selector: string; label: string } | null {
  // The capture layer sits on top of everything, so look past our own UI.
  const hit = document
    .elementsFromPoint(clientX, clientY)
    .find((e) => e instanceof HTMLElement && !isReviewUi(e));
  if (!hit) return null;

  let el = hit as HTMLElement;
  while (el.parentElement && el !== document.body) {
    const r = el.getBoundingClientRect();
    const tiny = r.width < 16 || r.height < 12;
    const decorative = el.tagName === "SVG" || el.tagName === "PATH" || el instanceof SVGElement;
    if (!tiny && !decorative) break;
    el = el.parentElement;
  }
  if (el === document.body || el === document.documentElement) return null;

  return { el, selector: buildSelector(el), label: describe(el) };
}

/** Viewport position of a pin, or null when it cannot be placed right now. */
export function pinPosition(pin: {
  anchor: string;
  x_pct: number;
  y_pct: number;
  page_x: number;
  page_y: number;
}): { x: number; y: number; orphan: boolean } | null {
  const el = resolveAnchor(pin.anchor);
  if (el) {
    const r = el.getBoundingClientRect();
    // A zero-size box means the element is hidden (closed tab, collapsed row).
    if (r.width > 0 || r.height > 0) {
      return { x: r.left + r.width * pin.x_pct, y: r.top + r.height * pin.y_pct, orphan: false };
    }
    return null;
  }
  // Anchor is gone — fall back to where it was dropped in the document.
  const x = pin.page_x - window.scrollX;
  const y = pin.page_y - window.scrollY;
  if (x < -200 || y < -200 || x > window.innerWidth + 200) return null;
  return { x, y, orphan: true };
}
