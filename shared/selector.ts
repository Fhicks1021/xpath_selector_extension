export type OutputMode = "xpath" | "css";

export type SelectorResult = {
  preferred: string;
  alternate: string | null;
  debug: {
    strategy: string;
    anchor?: string;
    targetTag: string;
  };
};

const TEST_ATTRS = ["data-test", "data-testid", "data-test-id", "data-qa", "data-cy"] as const;
const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select", "textarea", "option"]);
const ANCHOR_ATTRS = ["id", "name", "aria-label", "placeholder", "title", "alt", "src", "href"] as const;
const MAX_TEST_HOPS = 4;
const MAX_DATA_HOPS = 3;
const MAX_GENERIC_HOPS = 3;

type StableAttr = {
  attr: string;
  value: string;
  kind: "test" | "data" | "generic";
};

function isElement(n: unknown): n is Element {
  return !!n && typeof n === "object" && (n as Element).nodeType === 1;
}

function normText(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function quoteXpath(text: string): string {
  if (!text.includes("'")) return `'${text}'`;
  const parts = text.split("'").map(part => `'${part}'`);
  return `concat(${parts.join(", \"'\", ")})`;
}

function escapeCssValue(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getTag(el: Element): string {
  return el.tagName.toLowerCase();
}

function isInteractive(el: Element): boolean {
  const tag = getTag(el);
  return INTERACTIVE_TAGS.has(tag) || el.getAttribute("role") === "button" || el.getAttribute("role") === "link";
}

function getInteractiveRoot(target: Element): Element {
  if (isInteractive(target)) return target;

  const label = target.closest("label");
  if (label) {
    const control = getControlForLabel(label);
    if (control) return control;
  }

  const interactiveAncestor = target.closest("a, button, input, select, textarea, option, [role='button'], [role='link']");
  if (interactiveAncestor) return interactiveAncestor;

  return target;
}

function getControlForLabel(label: Element): Element | null {
  if (label instanceof HTMLLabelElement) {
    if (label.control) return label.control;

    const forId = label.htmlFor?.trim();
    if (forId) {
      const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(forId) : forId;
      const byId = label.ownerDocument?.querySelector(`#${escaped}`);
      if (byId) return byId;
    }
  }

  const contained = label.querySelector("input, select, textarea, button");
  if (contained) return contained;

  const parent = label.parentElement;
  if (!parent) return null;

  const nearby = parent.querySelector("input, select, textarea, button");
  return nearby ?? null;
}

function evaluateXPathCount(xpath: string, doc: Document): number {
  try {
    const res = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    return res.snapshotLength;
  } catch {
    return 0;
  }
}

function buildAttrXPath(tag: string | "*", attr: string, value: string): string {
  return `//${tag}[@${attr}=${quoteXpath(value)}]`;
}

function buildAttrCss(attr: string, value: string): string {
  return `[${attr}="${escapeCssValue(value)}"]`;
}

function getStableAttrs(el: Element): StableAttr[] {
  const hits: StableAttr[] = [];

  for (const attr of TEST_ATTRS) {
    const value = el.getAttribute(attr)?.trim();
    if (value) hits.push({ attr, value, kind: "test" });
  }

  for (const attr of el.getAttributeNames()) {
    if (TEST_ATTRS.includes(attr as (typeof TEST_ATTRS)[number])) continue;
    if (!attr.startsWith("data-")) continue;

    const value = el.getAttribute(attr)?.trim();
    if (!value) continue;
    if (value.length > 120) continue;
    hits.push({ attr, value, kind: "data" });
  }

  for (const attr of ANCHOR_ATTRS) {
    const value = el.getAttribute(attr)?.trim();
    if (!value) continue;
    if (value.length > 200) continue;
    if ((attr === "src" || attr === "href") && value.startsWith("data:")) continue;
    hits.push({ attr, value, kind: "generic" });
  }

  return hits;
}

function getUniqueStableAttr(el: Element, doc: Document, preferredKind?: StableAttr["kind"]): StableAttr | null {
  const attrs = getStableAttrs(el);
  const ordered = preferredKind ? attrs.sort((a, b) => Number(b.kind === preferredKind) - Number(a.kind === preferredKind)) : attrs;
  const tag = getTag(el);

  for (const hit of ordered) {
    const anyTagXPath = buildAttrXPath("*", hit.attr, hit.value);
    if (evaluateXPathCount(anyTagXPath, doc) === 1) return hit;

    const sameTagXPath = buildAttrXPath(tag, hit.attr, hit.value);
    if (evaluateXPathCount(sameTagXPath, doc) === 1) return hit;
  }

  return null;
}

function getChildStep(parent: Element, child: Element, preferStableTarget: boolean): string {
  const tag = getTag(child);

  if (preferStableTarget) {
    const id = child.getAttribute("id")?.trim();
    if (id) return `${tag}[@id=${quoteXpath(id)}]`;

    const name = child.getAttribute("name")?.trim();
    if (name) return `${tag}[@name=${quoteXpath(name)}]`;
  }

  const siblings = parent.children;
  let index = 0;
  let total = 0;

  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[i];
    if (getTag(sibling) !== tag) continue;
    total += 1;
    if (sibling === child) index = total;
  }

  return total > 1 ? `${tag}[${index}]` : tag;
}

function buildDescendantXPath(anchor: Element, target: Element): string | null {
  if (anchor === target) return ".";
  if (!anchor.contains(target)) return null;

  const steps: string[] = [];
  let current: Element | null = target;

  while (current && current !== anchor) {
    const parent = current.parentElement;
    if (!parent) return null;
    steps.push(getChildStep(parent, current, current === target));
    current = parent;
  }

  return `.//${steps.reverse().join("/")}`;
}

function buildDescendantCss(anchor: Element, target: Element): string | null {
  if (anchor === target) return null;
  if (!anchor.contains(target)) return null;

  const steps: string[] = [];
  let current: Element | null = target;

  while (current && current !== anchor) {
    const parent = current.parentElement;
    if (!parent) return null;

    const tag = getTag(current);
    const id = current === target ? current.getAttribute("id")?.trim() : null;
    if (id) {
      const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(id) : id;
      steps.push(`#${escaped}`);
      break;
    }

    const name = current === target ? current.getAttribute("name")?.trim() : null;
    if (name) {
      steps.push(`${tag}[name="${escapeCssValue(name)}"]`);
      break;
    }

    const siblings = Array.from(parent.children).filter(child => getTag(child) === tag);
    if (siblings.length > 1) {
      const index = siblings.indexOf(current) + 1;
      steps.push(`${tag}:nth-of-type(${index})`);
    } else {
      steps.push(tag);
    }

    current = parent;
  }

  return steps.length ? steps.reverse().join(" > ") : null;
}

function findNearbyAnchor(target: Element, doc: Document, maxHops: number, preferredKind: StableAttr["kind"]): { el: Element; hit: StableAttr; hop: number } | null {
  let current: Element | null = target;

  for (let hop = 0; hop <= maxHops; hop++) {
    if (!current) break;
    const hit = getUniqueStableAttr(current, doc, preferredKind);
    if (hit && hit.kind === preferredKind) {
      return { el: current, hit, hop };
    }
    current = current.parentElement;
  }

  return null;
}

function buildFromAnchor(anchor: Element, anchorHit: StableAttr, target: Element, mode: OutputMode): SelectorResult | null {
  const anchorTag = getTag(anchor);
  const anchorXPath = buildAttrXPath(anchorTag, anchorHit.attr, anchorHit.value);
  const relXPath = buildDescendantXPath(anchor, target);

  if (!relXPath) return null;

  const anchorCss = anchor.id
    ? `#${typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(anchor.id) : anchor.id}`
    : buildAttrCss(anchorHit.attr, anchorHit.value);
  const relCss = buildDescendantCss(anchor, target);
  const css = relCss ? `${anchorCss} ${relCss}` : anchorCss;
  const xpath = relXPath === "." ? anchorXPath : `${anchorXPath}${relXPath.slice(1)}`;

  return {
    preferred: mode === "xpath" ? xpath : css,
    alternate: mode === "xpath" ? css : xpath,
    debug: {
      strategy: `${anchorHit.kind}_anchor_${anchor === target ? "self" : "ancestor"}`,
      anchor: `${anchorHit.attr}=${anchorHit.value}`,
      targetTag: getTag(target)
    }
  };
}

function getAssociatedLabel(target: Element): HTMLLabelElement | null {
  if ("labels" in target) {
    const labels = (target as HTMLInputElement).labels;
    if (labels?.length) return labels[0];
  }

  const id = target.getAttribute("id")?.trim();
  if (id) {
    const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(id) : id;
    const direct = target.ownerDocument?.querySelector(`label[for="${escaped}"]`);
    if (direct instanceof HTMLLabelElement) return direct;
  }

  const wrapped = target.closest("label");
  return wrapped instanceof HTMLLabelElement ? wrapped : null;
}

function buildLabelSelector(target: Element, mode: OutputMode, doc: Document): SelectorResult | null {
  const label = getAssociatedLabel(target);
  if (!label) return null;

  const labelText = normText(label.textContent || "");
  if (!labelText || labelText.length > 80) return null;

  const labelXPath = `//label[normalize-space(.)=${quoteXpath(labelText)}]`;
  if (evaluateXPathCount(labelXPath, doc) !== 1) return null;

  const targetTag = getTag(target);
  const targetId = target.getAttribute("id")?.trim();
  const targetName = target.getAttribute("name")?.trim();
  const targetPredicate = targetId
    ? `[@id=${quoteXpath(targetId)}]`
    : targetName
      ? `[@name=${quoteXpath(targetName)}]`
      : "";

  const relation = label.compareDocumentPosition(target);
  const axis = relation & Node.DOCUMENT_POSITION_PRECEDING ? "preceding" : "following";
  const xpath = `${labelXPath}/${axis}::${targetTag}${targetPredicate}[1]`;

  const css = targetId
    ? `#${typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(targetId) : targetId}`
    : targetName
      ? `${targetTag}[name="${escapeCssValue(targetName)}"]`
      : null;

  return {
    preferred: mode === "xpath" ? xpath : css ?? xpath,
    alternate: mode === "xpath" ? css : xpath,
    debug: {
      strategy: "label_anchor",
      anchor: labelText,
      targetTag
    }
  };
}

function buildDirectElementSelector(target: Element, mode: OutputMode, doc: Document): SelectorResult | null {
  const targetTag = getTag(target);
  const id = target.getAttribute("id")?.trim();
  if (id) {
    const xpath = `//${targetTag}[@id=${quoteXpath(id)}]`;
    if (evaluateXPathCount(xpath, doc) === 1) {
      const css = `#${typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(id) : id}`;
      return {
        preferred: mode === "xpath" ? xpath : css,
        alternate: mode === "xpath" ? css : xpath,
        debug: {
          strategy: "direct_id",
          anchor: id,
          targetTag
        }
      };
    }
  }

  const name = target.getAttribute("name")?.trim();
  if (name) {
    const xpath = `//${targetTag}[@name=${quoteXpath(name)}]`;
    if (evaluateXPathCount(xpath, doc) === 1) {
      const css = `${targetTag}[name="${escapeCssValue(name)}"]`;
      return {
        preferred: mode === "xpath" ? xpath : css,
        alternate: mode === "xpath" ? css : xpath,
        debug: {
          strategy: "direct_name",
          anchor: name,
          targetTag
        }
      };
    }
  }

  return null;
}

function buildDirectLinkSelector(target: Element, mode: OutputMode, doc: Document): SelectorResult | null {
  if (getTag(target) !== "a") return null;

  const href = target.getAttribute("href")?.trim();
  if (!href) return null;

  const hrefXPath = `//a[@href=${quoteXpath(href)}]`;
  if (evaluateXPathCount(hrefXPath, doc) === 1) {
    const css = `a[href="${escapeCssValue(href)}"]`;
    return {
      preferred: mode === "xpath" ? hrefXPath : css,
      alternate: mode === "xpath" ? css : hrefXPath,
      debug: {
        strategy: "direct_href",
        anchor: href,
        targetTag: "a"
      }
    };
  }

  const text = normText(target.textContent || "");
  if (text) {
    const hrefAndTextXPath = `//a[@href=${quoteXpath(href)} and normalize-space(.)=${quoteXpath(text)}]`;
    if (evaluateXPathCount(hrefAndTextXPath, doc) === 1) {
      return {
        preferred: mode === "xpath" ? hrefAndTextXPath : `a[href="${escapeCssValue(href)}"]`,
        alternate: mode === "xpath" ? `a[href="${escapeCssValue(href)}"]` : hrefAndTextXPath,
        debug: {
          strategy: "href_with_text",
          anchor: `${href} | ${text}`,
          targetTag: "a"
        }
      };
    }
  }

  const childImage = target.querySelector("img");
  if (childImage) {
    const alt = childImage.getAttribute("alt")?.trim();
    if (alt) {
      const hrefAndAltXPath = `//a[@href=${quoteXpath(href)} and .//img[@alt=${quoteXpath(alt)}]]`;
      if (evaluateXPathCount(hrefAndAltXPath, doc) === 1) {
        return {
          preferred: mode === "xpath" ? hrefAndAltXPath : `a[href="${escapeCssValue(href)}"]`,
          alternate: mode === "xpath" ? `a[href="${escapeCssValue(href)}"]` : hrefAndAltXPath,
          debug: {
            strategy: "href_with_img_alt",
            anchor: `${href} | ${alt}`,
            targetTag: "a"
          }
        };
      }
    }

    const src = childImage.getAttribute("src")?.trim();
    if (src) {
      const hrefAndSrcXPath = `//a[@href=${quoteXpath(href)} and .//img[@src=${quoteXpath(src)}]]`;
      if (evaluateXPathCount(hrefAndSrcXPath, doc) === 1) {
        return {
          preferred: mode === "xpath" ? hrefAndSrcXPath : `a[href="${escapeCssValue(href)}"]`,
          alternate: mode === "xpath" ? `a[href="${escapeCssValue(href)}"]` : hrefAndSrcXPath,
          debug: {
            strategy: "href_with_img_src",
            anchor: `${href} | ${src}`,
            targetTag: "a"
          }
        };
      }
    }
  }

  return null;
}

function buildUniqueAncestorTagSelector(target: Element, mode: OutputMode, doc: Document): SelectorResult | null {
  let current: Element | null = target.parentElement;
  let hopCount = 1;

  while (current) {
    const ancestorTag = getTag(current);
    if (ancestorTag === "html" || ancestorTag === "body") {
      current = current.parentElement;
      hopCount += 1;
      continue;
    }

    if (hopCount > 4) return null;

    const ancestorXPath = `//${ancestorTag}`;
    if (evaluateXPathCount(ancestorXPath, doc) === 1) {
      const relXPath = buildDescendantXPath(current, target);
      if (!relXPath) return null;

      const xpath = relXPath === "." ? ancestorXPath : `${ancestorXPath}${relXPath.slice(1)}`;
      if (evaluateXPathCount(xpath, doc) === 1) {
        const relCss = buildDescendantCss(current, target);
        const css = relCss ? `${ancestorTag} ${relCss}` : ancestorTag;

        return {
          preferred: mode === "xpath" ? xpath : css,
          alternate: mode === "xpath" ? css : xpath,
          debug: {
            strategy: "unique_ancestor_tag",
            anchor: ancestorTag,
            targetTag: getTag(target)
          }
        };
      }
    }

    current = current.parentElement;
    hopCount += 1;
  }

  return null;
}

function buildTextFallback(target: Element, mode: OutputMode, doc: Document): SelectorResult | null {
  const text = normText(target.textContent || "");
  if (!text || text.length > 60) return null;

  const targetTag = getTag(target);
  const exactByTag = `//${targetTag}[normalize-space(.)=${quoteXpath(text)}]`;
  if (evaluateXPathCount(exactByTag, doc) === 1) {
    return {
      preferred: mode === "xpath" ? exactByTag : targetTag,
      alternate: mode === "xpath" ? targetTag : exactByTag,
      debug: {
        strategy: "text_fallback_tag_exact",
        anchor: text,
        targetTag
      }
    };
  }

  const exactAny = `//*[normalize-space(.)=${quoteXpath(text)}]`;
  if (evaluateXPathCount(exactAny, doc) !== 1) return null;

  return {
    preferred: mode === "xpath" ? exactAny : targetTag,
    alternate: mode === "xpath" ? targetTag : exactAny,
    debug: {
      strategy: "text_fallback",
      anchor: text,
      targetTag
    }
  };
}

export function generateSelectors(clicked: Element, mode: OutputMode, doc: Document): SelectorResult | null {
  const target = getInteractiveRoot(clicked);

  const directTest = getUniqueStableAttr(target, doc, "test");
  if (directTest && directTest.kind === "test") {
    return buildFromAnchor(target, directTest, target, mode)!;
  }

  const nearbyTestAnchor = findNearbyAnchor(target, doc, MAX_TEST_HOPS, "test");
  if (nearbyTestAnchor) {
    const anchored = buildFromAnchor(nearbyTestAnchor.el, nearbyTestAnchor.hit, target, mode);
    if (anchored) return anchored;
  }

  const nearbyDataAnchor = findNearbyAnchor(target, doc, MAX_DATA_HOPS, "data");
  if (nearbyDataAnchor) {
    const anchored = buildFromAnchor(nearbyDataAnchor.el, nearbyDataAnchor.hit, target, mode);
    if (anchored) return anchored;
  }

  const directElementSelector = buildDirectElementSelector(target, mode, doc);
  if (directElementSelector) return directElementSelector;

  const directLinkSelector = buildDirectLinkSelector(target, mode, doc);
  if (directLinkSelector) return directLinkSelector;

  const labelSelector = buildLabelSelector(target, mode, doc);
  if (labelSelector) return labelSelector;

  const directGeneric = getUniqueStableAttr(target, doc, "generic");
  if (directGeneric && directGeneric.kind === "generic") {
    return buildFromAnchor(target, directGeneric, target, mode)!;
  }

  const nearbyGenericAnchor = findNearbyAnchor(target, doc, MAX_GENERIC_HOPS, "generic");
  if (nearbyGenericAnchor) {
    const anchored = buildFromAnchor(nearbyGenericAnchor.el, nearbyGenericAnchor.hit, target, mode);
    if (anchored) return anchored;
  }

  const uniqueAncestorTagSelector = buildUniqueAncestorTagSelector(target, mode, doc);
  if (uniqueAncestorTagSelector) return uniqueAncestorTagSelector;

  const textFallback = buildTextFallback(target, mode, doc);
  if (textFallback) return textFallback;

  return null;
}
