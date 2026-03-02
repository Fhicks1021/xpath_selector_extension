import { ANCHOR_ATTRS, CONTENT_CONTAINER_TAGS, INTERACTIVE_TAGS, TEST_ATTRS } from "./constants";
import type { OutputMode, StableAttr } from "./types";
import { buildAttrXPath } from "./xpath";

type EvaluationCache = {
  css: Map<string, number>;
  xpath: Map<string, number>;
};

let currentEvaluationCache: EvaluationCache | null = null;

export function isElement(n: unknown): n is Element {
  return !!n && typeof n === "object" && (n as Element).nodeType === 1;
}

export function normText(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

export function getTag(el: Element): string {
  return el.tagName.toLowerCase();
}

function escapeCssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function isInteractive(el: Element): boolean {
  const tag = getTag(el);
  return INTERACTIVE_TAGS.has(tag) || el.getAttribute("role") === "button" || el.getAttribute("role") === "link";
}

export function getControlForLabel(label: Element): Element | null {
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

export function getInteractiveRoot(target: Element): Element {
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

export function evaluateXPathCount(xpath: string, doc: Document): number {
  const cached = currentEvaluationCache?.xpath.get(xpath);
  if (cached != null) return cached;

  let count = 0;
  try {
    const res = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    count = res.snapshotLength;
  } catch {
    count = 0;
  }

  currentEvaluationCache?.xpath.set(xpath, count);
  return count;
}

export function evaluateCssCount(selector: string, doc: Document): number {
  const cached = currentEvaluationCache?.css.get(selector);
  if (cached != null) return cached;

  let count = 0;
  try {
    count = doc.querySelectorAll(selector).length;
  } catch {
    count = 0;
  }

  currentEvaluationCache?.css.set(selector, count);
  return count;
}

export function evaluateModeCount(selector: string, mode: OutputMode, doc: Document): number {
  return mode === "css" ? evaluateCssCount(selector, doc) : evaluateXPathCount(selector, doc);
}

export function getAssociatedLabel(target: Element): HTMLLabelElement | null {
  if ("labels" in target) {
    const labels = (target as HTMLInputElement).labels;
    if (labels?.length) return labels[0];
  }

  const id = target.getAttribute("id")?.trim();
  if (id) {
    const direct = target.ownerDocument?.querySelector(`label[for="${escapeCssAttributeValue(id)}"]`);
    if (direct instanceof HTMLLabelElement) return direct;
  }

  const wrapped = target.closest("label");
  return wrapped instanceof HTMLLabelElement ? wrapped : null;
}

export function getStableAttrs(el: Element): StableAttr[] {
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

export function getUniqueStableAttr(el: Element, doc: Document, preferredKind?: StableAttr["kind"]): StableAttr | null {
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

export function findNearbyAnchor(target: Element, doc: Document, maxHops: number, preferredKind: StableAttr["kind"]): { el: Element; hit: StableAttr; hop: number } | null {
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

export function getLocalContentContainers(start: Element, maxHops: number): Element[] {
  const containers: Element[] = [];
  let current: Element | null = start.parentElement;
  let hopCount = 1;

  while (current && hopCount <= maxHops) {
    if (CONTENT_CONTAINER_TAGS.has(getTag(current))) containers.push(current);
    current = current.parentElement;
    hopCount += 1;
  }

  return containers;
}

export function withEvaluationCache<T>(fn: () => T): T {
  const previousCache = currentEvaluationCache;
  currentEvaluationCache = { css: new Map(), xpath: new Map() };

  try {
    return fn();
  } finally {
    currentEvaluationCache = previousCache;
  }
}
