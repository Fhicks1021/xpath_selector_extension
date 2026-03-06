import { ANCHOR_ATTRS, MAX_CANDIDATES_PER_PRIORITY, SEMANTIC_CONTAINER_TAGS } from "./constants";
import { evaluateCssCount, evaluateXPathCount, getTag } from "./dom";
import type { ClassSelectorCandidate, OutputMode, StableAttr } from "./types";
import { buildClassXPath, buildTaggedAttrXPath, quoteXpath } from "./xpath";

export function escapeCssValue(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildAttrCss(attr: string, value: string): string {
  return `[${attr}="${escapeCssValue(value)}"]`;
}

export function buildTaggedAttrCss(tag: string, attr: string, value: string): string {
  return `${tag}${buildAttrCss(attr, value)}`;
}

export function escapeCssIdentifier(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

export function isStableClassName(name: string): boolean {
  if (!name) return false;
  if (name.length > 60) return false;
  if (/^(active|disabled|focus|hover|open|selected)$/.test(name)) return false;
  if (/^(ember|js-|is-|has-)/.test(name)) return false;
  if (/^(?:m|p)(?:[trblxy])?--/.test(name)) return false;
  return true;
}

export function isGoodId(value: string): boolean {
  if (!value) return false;
  if (value.length < 3 || value.length > 80) return false;
  if (/^\d+$/.test(value)) return false;
  if (/^(ember|react|headlessui|radix|mui-|chakra-|ng-)/.test(value)) return false;
  if (/[A-Fa-f0-9]{8,}/.test(value) && /\d/.test(value)) return false;
  if (/[:\s]/.test(value)) return false;
  return true;
}

export function buildClassSelector(tag: string, classNames: string[]): string {
  const suffix = classNames.map(className => `.${escapeCssIdentifier(className)}`).join("");
  return `${tag}${suffix}`;
}

export function getStableClassNames(el: Element): string[] {
  return Array.from(el.classList).filter(isStableClassName);
}

export function getClassSelectorCandidates(tag: string, classNames: string[], doc: Document, mode: OutputMode = "css"): ClassSelectorCandidate[] {
  if (!classNames.length) return [];

  const candidates: ClassSelectorCandidate[] = [];
  const seen = new Set<string>();

  for (let size = 1; size <= Math.min(classNames.length, 4); size++) {
    for (let start = 0; start <= classNames.length - size; start++) {
      const subset = classNames.slice(start, start + size);
      const css = buildClassSelector(tag, subset);
      const xpath = buildClassXPath(tag, subset);
      const isCssUnique = evaluateCssCount(css, doc) === 1;
      const isXPathUnique = evaluateXPathCount(xpath, doc) === 1;
      if ((mode === "css" && !isCssUnique) || (mode === "xpath" && !isXPathUnique)) continue;

      if (!seen.has(css)) {
        candidates.push({ css, xpath });
        seen.add(css);
      }
      if (candidates.length >= MAX_CANDIDATES_PER_PRIORITY) return candidates;
    }
  }

  const fullCss = buildClassSelector(tag, classNames);
  const fullXPath = buildClassXPath(tag, classNames);
  const isFullCssUnique = evaluateCssCount(fullCss, doc) === 1;
  const isFullXPathUnique = evaluateXPathCount(fullXPath, doc) === 1;
  if ((mode === "css" && !isFullCssUnique) || (mode === "xpath" && !isFullXPathUnique)) return candidates;

  if (!seen.has(fullCss)) candidates.push({ css: fullCss, xpath: fullXPath });
  return candidates;
}

export function buildSemanticAncestorCss(el: Element): string | null {
  const tag = getTag(el);
  if (!SEMANTIC_CONTAINER_TAGS.has(tag)) return null;

  if (tag === "form") {
    const method = el.getAttribute("method")?.trim();
    if (method) return `form[method="${escapeCssValue(method)}"]`;

    const action = el.getAttribute("action")?.trim();
    if (action) return `form[action="${escapeCssValue(action)}"]`;

    return "form";
  }

  return tag;
}

export function buildTypedControlCss(target: Element): string {
  const tag = getTag(target);
  const type = target.getAttribute("type")?.trim();
  if (type) return `${tag}[type="${escapeCssValue(type)}"]`;
  return tag;
}

export function getStableAttrs(el: Element): StableAttr[] {
  const hits: StableAttr[] = [];

  for (const attr of ANCHOR_ATTRS) {
    const value = el.getAttribute(attr)?.trim();
    if (!value) continue;
    if (value.length > 200) continue;
    if ((attr === "src" || attr === "href") && value.startsWith("data:")) continue;
    hits.push({ attr, value, kind: "generic" });
  }

  return hits;
}

export function getSemanticAttributeCandidates(target: Element): Array<{ css: string; xpath: string; strategy: string; anchor: string }> {
  const tag = getTag(target);
  const candidates: Array<{ css: string; xpath: string; strategy: string; anchor: string }> = [];

  const ariaLabel = target.getAttribute("aria-label")?.trim();
  if (ariaLabel) {
    candidates.push({
      css: `${tag}[aria-label="${escapeCssValue(ariaLabel)}"]`,
      xpath: buildTaggedAttrXPath(tag, "aria-label", ariaLabel),
      strategy: "direct_aria_label",
      anchor: ariaLabel
    });
  }

  const alt = target.getAttribute("alt")?.trim();
  if (alt) {
    candidates.push({
      css: `${tag}[alt="${escapeCssValue(alt)}"]`,
      xpath: buildTaggedAttrXPath(tag, "alt", alt),
      strategy: "direct_alt",
      anchor: alt
    });
  }

  const autocomplete = target.getAttribute("autocomplete")?.trim();
  if (autocomplete) {
    candidates.push({
      css: `${tag}[autocomplete="${escapeCssValue(autocomplete)}"]`,
      xpath: buildTaggedAttrXPath(tag, "autocomplete", autocomplete),
      strategy: "direct_autocomplete",
      anchor: autocomplete
    });
  }

  const placeholder = target.getAttribute("placeholder")?.trim();
  if (placeholder) {
    candidates.push({
      css: `${tag}[placeholder="${escapeCssValue(placeholder)}"]`,
      xpath: buildTaggedAttrXPath(tag, "placeholder", placeholder),
      strategy: "direct_placeholder",
      anchor: placeholder
    });
  }

  const role = target.getAttribute("role")?.trim();
  if (role && ariaLabel) {
    candidates.push({
      css: `${tag}[role="${escapeCssValue(role)}"][aria-label="${escapeCssValue(ariaLabel)}"]`,
      xpath: `//${tag}[@role=${quoteXpath(role)} and @aria-label=${quoteXpath(ariaLabel)}]`,
      strategy: "direct_role_aria_label",
      anchor: `${role} | ${ariaLabel}`
    });
  }

  return candidates;
}
