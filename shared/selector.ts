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

function isElement(n: unknown): n is Element {
  return !!n && typeof n === "object" && (n as Element).nodeType === 1;
}

function normText(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function quoteXpath(text: string): string {
  if (!text.includes("'")) return `'${text}'`;
  const parts = text.split("'").map(p => `'${p}'`);
  return `concat(${parts.join(", \"'\", ")})`;
}

function getTag(el: Element): string {
  return el.tagName.toLowerCase();
}

function getTestAttr(el: Element): { attr: string; value: string } | null {
  for (const a of TEST_ATTRS) {
    const v = el.getAttribute(a);
    if (v && v.trim()) return { attr: a, value: v.trim() };
  }
  return null;
}

function cssByAttr(attr: string, value: string): string {
  const safe = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `[${attr}="${safe}"]`;
}

function xpathByAttr(tag: string | "*", attr: string, value: string): string {
  return `//${tag}[@${attr}=${quoteXpath(value)}]`;
}

function evaluateXPathCount(xpath: string, doc: Document): number {
  try {
    const res = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    return res.snapshotLength;
  } catch {
    return 0;
  }
}

function findNearestTestAnchor(target: Element, maxHops: number): { el: Element; hop: number; hit: { attr: string; value: string } } | null {
  let cur: Element | null = target;
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!cur) break;
    const hit = getTestAttr(cur);
    if (hit) return { el: cur, hop, hit };
    cur = cur.parentElement;
  }
  return null;
}

function findLabelTextCandidate(el: Element): string | null {
  const direct = normText(el.textContent || "");
  if (direct && direct.length <= 40) return direct;

  const span = el.querySelector("span");
  if (span) {
    const s = normText(span.textContent || "");
    if (s && s.length <= 40) return s;
  }

  return null;
}

function buildTextXPathCandidates(text: string): { exact: string; contains: string } {
  const exact = `//*[normalize-space(.)=${quoteXpath(text)}]`;
  const contains = `//*[contains(normalize-space(.),${quoteXpath(text)})]`;
  return { exact, contains };
}

function buildFromAnchorToTargetXPath(anchor: Element, target: Element): string | null {
  if (anchor.contains(target)) {
    const t = getTag(target);
    const hit = getTestAttr(target);
    if (hit) return `.${xpathByAttr(t, hit.attr, hit.value).replace(/^\/\//, "//")}`;

    const id = target.getAttribute("id");
    if (id) return `.//${t}[@id=${quoteXpath(id)}]`;

    const name = target.getAttribute("name");
    if (name) return `.//${t}[@name=${quoteXpath(name)}]`;

    return `.//${t}[1]`;
  }

  const t = getTag(target);
  return `.//following::${t}[1]`;
}

export function generateSelectors(target: Element, mode: OutputMode, doc: Document): SelectorResult {
  const targetTag = getTag(target);

  const directHit = getTestAttr(target);
  if (directHit) {
    const xpath = xpathByAttr(targetTag, directHit.attr, directHit.value);
    const css = cssByAttr(directHit.attr, directHit.value);
    return {
      preferred: mode === "xpath" ? xpath : css,
      alternate: mode === "xpath" ? css : xpath,
      debug: { strategy: "target_test_attr", anchor: `${directHit.attr}=${directHit.value}`, targetTag }
    };
  }

  const anchor = findNearestTestAnchor(target, 3);
  if (anchor) {
    const anchorTag = getTag(anchor.el);
    const anchorXPath = xpathByAttr(anchorTag, anchor.hit.attr, anchor.hit.value);

    const rel = buildFromAnchorToTargetXPath(anchor.el, target);
    const combined = rel?.startsWith(".//")
      ? `${anchorXPath}${rel.substring(1)}`
      : `${anchorXPath}//${targetTag}[1]`;

    const cssAnchor = cssByAttr(anchor.hit.attr, anchor.hit.value);
    const css = `${cssAnchor} ${targetTag}`;

    return {
      preferred: mode === "xpath" ? combined : css,
      alternate: mode === "xpath" ? css : combined,
      debug: { strategy: "nearby_anchor", anchor: `${anchor.hit.attr}=${anchor.hit.value}`, targetTag }
    };
  }

  const text = findLabelTextCandidate(target) || findLabelTextCandidate(target.parentElement ?? target);
  if (text) {
    const { exact, contains } = buildTextXPathCandidates(text);

    const ancestorButtonExact = `${exact}/ancestor::button[1]`;
    const ancestorButtonContains = `${contains}/ancestor::button[1]`;

    const exactCount = evaluateXPathCount(ancestorButtonExact, doc) || evaluateXPathCount(exact, doc);
    if (exactCount > 0) {
      const chosen = evaluateXPathCount(ancestorButtonExact, doc) > 0 ? ancestorButtonExact : exact;
      return {
        preferred: mode === "xpath" ? chosen : "",
        alternate: mode === "xpath" ? null : chosen,
        debug: { strategy: "text_fallback_exact", anchor: text, targetTag }
      };
    }

    const containsCount = evaluateXPathCount(ancestorButtonContains, doc) || evaluateXPathCount(contains, doc);
    if (containsCount > 0) {
      const chosen = evaluateXPathCount(ancestorButtonContains, doc) > 0 ? ancestorButtonContains : contains;
      return {
        preferred: mode === "xpath" ? chosen : "",
        alternate: mode === "xpath" ? null : chosen,
        debug: { strategy: "text_fallback_contains", anchor: text, targetTag }
      };
    }
  }

  const fallbackXPath = `//${targetTag}`;
  const fallbackCss = targetTag;

  return {
    preferred: mode === "xpath" ? fallbackXPath : fallbackCss,
    alternate: mode === "xpath" ? fallbackCss : fallbackXPath,
    debug: { strategy: "tag_only", targetTag }
  };
}
export {};
