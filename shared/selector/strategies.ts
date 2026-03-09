import {
  CONTENT_CONTAINER_TAGS,
  MAX_CANDIDATES_PER_PRIORITY,
  MAX_CONTENT_LINK_HOPS,
  MAX_NEARBY_MEANINGFUL_HOPS,
  SEMANTIC_CONTAINER_TAGS
} from "./constants";
import {
  evaluateCssCount,
  evaluateXPathCount,
  getAssociatedLabel,
  getLocalContentContainers,
  getStableAttrs,
  getTag,
  normText
} from "./dom";
import {
  buildAttrCss,
  buildSemanticAncestorCss,
  buildTaggedAttrCss,
  buildTypedControlCss,
  escapeCssIdentifier,
  escapeCssValue,
  getClassSelectorCandidates,
  getSemanticAttributeCandidates,
  getStableClassNames,
  isGoodId
} from "./css";
import type { OutputMode, SelectorResult, StableAttr } from "./types";
import { buildAttrXPath, buildTaggedAttrXPath, quoteXpath } from "./xpath";

type ParsedHrefMeta = {
  parsed: URL;
  path: string;
  query: string;
  params: Array<[string, string]>;
  pathSegments: string[];
  hasEncodedBlob: boolean;
  hasLongOpaqueToken: boolean;
  hasRandomFragment: boolean;
  hasHardRejectParams: boolean;
  hasSoftRejectParams: boolean;
  softRejectParamCount: number;
  hasOverlongValue: boolean;
  hasComplexValue: boolean;
  hasSearchLikePath: boolean;
  hasBadGpCatchAllPath: boolean;
  hasGenericFamilyRootOnly: boolean;
  hasCanonicalFamily: boolean;
  pathLooksCanonical: boolean;
};

function isCanonicalNumericResourcePath(path: string): boolean {
  return /^\/(?:rooms?|listings?|products?|articles?)\/\d+(?:\/|$)/i.test(path);
}

function isHardRejectQueryKey(key: string): boolean {
  const k = key.toLowerCase();
  if (k.startsWith("utm_")) return true;
  if (k.startsWith("pf_rd_") || k.startsWith("pd_rd_")) return true;
  return [
    "gclid", "fbclid", "msclkid", "mc_eid", "session", "sid", "token", "auth", "nonce", "state", "phpsessid", "jsessionid",
    "ref", "ref_", "ref_src"
  ].includes(k);
}

function isSoftRejectQueryKey(key: string): boolean {
  const k = key.toLowerCase();
  return ["page", "sort", "filter", "view", "mode", "search", "q", "query", "keyword", "keywords", "start", "offset"].includes(k);
}

function isAllowedProductDefiningKey(key: string): boolean {
  const k = key.toLowerCase();
  return ["id", "sku", "variant", "color", "size", "pid"].includes(k);
}

const BLOCKED_SLUG_TOKENS = new Set([
  "search",
  "results",
  "category",
  "tag",
  "filter",
  "page",
  "sort",
  "login",
  "cart",
  "checkout"
]);

function getReadableSlugFromPath(path: string): string | null {
  const segments = path.split("/").filter(Boolean);
  if (!segments.length) return null;

  const lastSegment = segments[segments.length - 1].replace(/\.[a-z0-9]{2,5}$/i, "");
  if (!lastSegment || lastSegment.length < 20) return null;
  if ((lastSegment.match(/-/g) ?? []).length < 3) return null;
  if (!/^[a-z0-9-]+$/.test(lastSegment)) return null;

  const tokens = lastSegment.split("-").filter(Boolean);
  if (tokens.length < 4) return null;
  if (tokens.some(token => BLOCKED_SLUG_TOKENS.has(token))) return null;
  if (tokens.every(token => BLOCKED_SLUG_TOKENS.has(token))) return null;

  const letters = (lastSegment.match(/[a-z]/g) ?? []).length;
  const digits = (lastSegment.match(/\d/g) ?? []).length;
  if (letters < 8) return null;
  if (digits > letters) return null;

  const numericTokenCount = tokens.filter(token => /^\d+$/.test(token)).length;
  if (numericTokenCount > Math.floor(tokens.length / 2)) return null;

  return lastSegment;
}

function getCanonicalHrefContainsToken(path: string): string | null {
  const listingMatch = path.match(/\/listing\/(\d+)(?:[/?]|$)/i);
  if (listingMatch) return `/listing/${listingMatch[1]}`;

  const asinMatch = path.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  if (asinMatch) return `/dp/${asinMatch[1].toUpperCase()}`;

  const canonicalFamilyMatch = path.match(/^\/(product|products|item|p|collections|category|c)\/([a-z0-9][a-z0-9-]{1,})(?:\/|$)/i);
  if (canonicalFamilyMatch) return `/${canonicalFamilyMatch[1].toLowerCase()}/${canonicalFamilyMatch[2]}`;
  return null;
}

function parseHrefMeta(href: string, doc: Document): ParsedHrefMeta | null {
  if (!href || !href.trim()) return null;
  const trimmed = href.trim();
  if (trimmed === "#" || trimmed.startsWith("#")) return null;
  if (/^(?:javascript|mailto|tel|sms|data):/i.test(trimmed)) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed, doc.location.href);
  } catch {
    return null;
  }

  const path = parsed.pathname || "/";
  const query = parsed.search.startsWith("?") ? parsed.search.slice(1) : parsed.search;
  const pathSegments = path.split("/").filter(Boolean);
  const params: Array<[string, string]> = [];
  parsed.searchParams.forEach((value, key) => {
    params.push([key, value]);
  });

  const hasCanonicalFamily = /^\/(?:product|products|item|p|collections|category|c|rooms?|listings?|articles?)(?:\/|$)/i.test(path);
  const hasGenericFamilyRootOnly = /^\/(?:product|products|item|p|collections|category|c)\/?$/i.test(path);
  const hasSearchLikePath = /^\/(?:search|s|results?|discover|browse|cart|checkout|login|account|recommendations)(?:\/|$)/i.test(path);
  const hasBadGpCatchAllPath = /^\/gp\/(?!product\/|aw\/d\/)/i.test(path);
  const pathLooksCanonical = path.length <= 90 && pathSegments.length <= 5 && /^\/[a-z0-9/_-]*$/i.test(path);

  const hasEncodedBlob = /(?:%[0-9a-f]{2}){6,}/i.test(trimmed);
  const hasCanonicalContainsToken = Boolean(getCanonicalHrefContainsToken(path));
  const hasLongOpaqueToken = (isCanonicalNumericResourcePath(path) || hasCanonicalContainsToken)
    ? false
    : /[A-Za-z0-9_-]{24,}/.test(trimmed);
  const fragment = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  const hasRandomFragment = fragment.length > 24 || /[A-Za-z0-9_-]{16,}/.test(fragment);

  const hasHardRejectParams = params.some(([key]) => isHardRejectQueryKey(key));
  const softRejectParamCount = params.filter(([key]) => isSoftRejectQueryKey(key)).length;
  const hasSoftRejectParams = softRejectParamCount > 0;
  const hasOverlongValue = params.some(([, value]) => value.length > 50);
  const hasComplexValue = params.some(([, value]) => value.length > 40 || /[%+/=]/.test(value));

  return {
    parsed,
    path,
    query,
    params,
    pathSegments,
    hasEncodedBlob,
    hasLongOpaqueToken,
    hasRandomFragment,
    hasHardRejectParams,
    hasSoftRejectParams,
    softRejectParamCount,
    hasOverlongValue,
    hasComplexValue,
    hasSearchLikePath,
    hasBadGpCatchAllPath,
    hasGenericFamilyRootOnly,
    hasCanonicalFamily,
    pathLooksCanonical
  };
}

function getCanonicalHrefPrefix(href: string, doc: Document): string | null {
  const meta = parseHrefMeta(href, doc);
  if (!meta) return null;
  if (meta.hasEncodedBlob || meta.hasLongOpaqueToken || meta.hasRandomFragment || meta.hasHardRejectParams) return null;
  if (meta.hasSearchLikePath || meta.hasBadGpCatchAllPath || meta.hasGenericFamilyRootOnly) return null;
  if (!/^\/[a-zA-Z0-9/_-]*$/.test(meta.path)) return null;

  const roomMatch = meta.path.match(/^\/rooms\/(\d+)(?:\/|$)/);
  if (roomMatch) return `/rooms/${roomMatch[1]}`;

  if (meta.pathSegments.length >= 2) {
    const [first, second] = meta.pathSegments;
    if (/^[a-z0-9-]+$/i.test(first) && /^[a-z0-9-]{3,}$/i.test(second)) {
      return `/${first}/${second}`;
    }
  }

  if (!meta.query && !meta.parsed.hash && meta.pathLooksCanonical && meta.hasCanonicalFamily) return meta.path;
  return null;
}

function getHrefAttributePrefix(href: string, doc: Document): string | null {
  const canonicalPath = getCanonicalHrefPrefix(href, doc);
  if (!canonicalPath) return null;

  const meta = parseHrefMeta(href, doc);
  if (!meta) return null;
  if (href.startsWith("/")) return canonicalPath;
  if (/^https?:\/\//i.test(href)) return `${meta.parsed.origin}${canonicalPath}`;
  return null;
}

function getHrefAttributeContainsToken(href: string, doc: Document): string | null {
  const meta = parseHrefMeta(href, doc);
  if (!meta) return null;
  if (meta.hasEncodedBlob || meta.hasRandomFragment || meta.hasSearchLikePath || meta.hasBadGpCatchAllPath) return null;
  return getCanonicalHrefContainsToken(meta.path);
}

function getSafeCssHrefFilter(href: string, doc: Document): string | null {
  const hrefPrefix = getHrefAttributePrefix(href, doc);
  if (hrefPrefix) return `[href^="${escapeCssValue(hrefPrefix)}"]`;
  const hrefContainsToken = getHrefAttributeContainsToken(href, doc);
  if (hrefContainsToken) return `[href*="${escapeCssValue(hrefContainsToken)}"]`;
  if (getHrefQualityTier(href, doc) <= 2) return `[href="${escapeCssValue(href)}"]`;
  return null;
}

function isUsableImageSrcForSelector(src: string): boolean {
  if (!src || src.length > 120) return false;
  if (/[?#]/.test(src)) return false;
  if (/%[0-9a-f]{2}/i.test(src)) return false;
  return true;
}

function isUsableImageAltForSelector(alt: string): boolean {
  if (!alt) return false;
  if (alt.length > 70) return false;
  if (alt.includes("\n")) return false;
  if ((alt.match(/,/g) ?? []).length > 1) return false;
  if (/[|{}[\]<>]/.test(alt)) return false;
  return true;
}

function getHrefQualityTier(href: string, doc: Document): 1 | 2 | 3 | 4 {
  const meta = parseHrefMeta(href, doc);
  if (!meta) return 4;

  if (
    meta.hasEncodedBlob
    || meta.hasLongOpaqueToken
    || meta.hasRandomFragment
    || meta.hasHardRejectParams
    || meta.hasSearchLikePath
    || meta.hasBadGpCatchAllPath
    || meta.hasGenericFamilyRootOnly
    || meta.params.length > 3
    || meta.query.length > 90
    || meta.hasOverlongValue
    || meta.hasComplexValue
    || meta.softRejectParamCount > 1
  ) {
    return 4;
  }

  if (!meta.parsed.search && !meta.parsed.hash && meta.pathLooksCanonical && !meta.hasSoftRejectParams) return 1;

  if (meta.params.length <= 2 && meta.pathLooksCanonical) {
    const allParamsAllowed = meta.params.every(([key]) => isAllowedProductDefiningKey(key));
    if (allParamsAllowed) return 2;
  }

  if (meta.params.length <= 3 && meta.pathLooksCanonical) return 3;

  return 3;
}

function buildSemanticAncestorXPath(el: Element): string | null {
  const tag = getTag(el);
  if (!SEMANTIC_CONTAINER_TAGS.has(tag)) return null;

  if (tag === "form") {
    const method = el.getAttribute("method")?.trim();
    if (method) return buildTaggedAttrXPath("form", "method", method);

    const action = el.getAttribute("action")?.trim();
    if (action) return buildTaggedAttrXPath("form", "action", action);

    return "//form";
  }

  return `//${tag}`;
}

function buildTypedControlXPath(target: Element): string {
  const tag = getTag(target);
  const type = target.getAttribute("type")?.trim();
  if (type) return buildTaggedAttrXPath(tag, "type", type);
  return `//${tag}`;
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

export function buildDescendantXPath(anchor: Element, target: Element): string | null {
  if (anchor === target) return ".";
  if (!anchor.contains(target)) return null;

  const steps: string[] = [];
  let current: Element | null = target;

  while (current && current !== anchor) {
    const parent: Element | null = current.parentElement;
    if (!parent) return null;
    steps.push(getChildStep(parent, current, current === target));
    current = parent;
  }

  return `.//${steps.reverse().join("/")}`;
}

export function buildDescendantCss(anchor: Element, target: Element): string | null {
  if (anchor === target) return null;
  if (!anchor.contains(target)) return null;

  const steps: string[] = [];
  let current: Element | null = target;

  while (current && current !== anchor) {
    const parent: Element | null = current.parentElement;
    if (!parent) return null;

    const tag = getTag(current);
    const id = current === target ? current.getAttribute("id")?.trim() : null;
    if (id) {
      steps.push(`#${escapeCssIdentifier(id)}`);
      break;
    }

    const name = current === target ? current.getAttribute("name")?.trim() : null;
    if (name) {
      steps.push(`${tag}[name="${escapeCssValue(name)}"]`);
      break;
    }

    if (current === target) {
      const uniqueClassSelector = getClassSelectorCandidates(tag, getStableClassNames(current), current.ownerDocument)[0];
      if (uniqueClassSelector) {
        steps.push(uniqueClassSelector.css);
        break;
      }
    }

    const siblings = Array.from(parent.children).filter((child: Element) => getTag(child) === tag);
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

export function buildFromAnchor(anchor: Element, anchorHit: StableAttr, target: Element, mode: OutputMode): SelectorResult | null {
  const anchorTag = getTag(anchor);
  const anchorXPath = buildAttrXPath(anchorTag, anchorHit.attr, anchorHit.value);
  const relXPath = buildDescendantXPath(anchor, target);
  if (!relXPath) return null;

  const anchorCss = anchor.id
    ? `#${typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(anchor.id) : anchor.id}`
    : buildTaggedAttrCss(anchorTag, anchorHit.attr, anchorHit.value);
  const relCss = buildDescendantCss(anchor, target);
  const css = relCss ? `${anchorCss} ${relCss}` : anchorCss;
  const xpath = relXPath === "." ? anchorXPath : `${anchorXPath}${relXPath.slice(1)}`;

  const targetTag = getTag(target);
  if (anchor !== target && anchorHit.attr === "data-asin") {
    const asin = anchorHit.value.trim().toUpperCase();
    const prioritizedPairs: Array<{ xpath: string; css: string }> = [];
    const anchorScopes: Array<{ xpath: string; css: string }> = [{ xpath: anchorXPath, css: anchorCss }];

    const nearestIndexScope = target.closest("[data-test-index]");
    const testIndex = nearestIndexScope?.getAttribute("data-test-index")?.trim();
    if (testIndex) {
      anchorScopes.unshift({
        xpath: `//*[@data-test-index=${quoteXpath(testIndex)}]//${anchorTag}[@${anchorHit.attr}=${quoteXpath(anchorHit.value)}]`,
        css: `[data-test-index="${escapeCssValue(testIndex)}"] ${anchorCss}`
      });
    }

    const nearestIdScope = target.closest("[id]");
    const scopeId = nearestIdScope?.getAttribute("id")?.trim();
    if (scopeId) {
      const scopeCss = `#${typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(scopeId) : scopeId}`;
      anchorScopes.unshift({
        xpath: `//*[@id=${quoteXpath(scopeId)}]//${anchorTag}[@${anchorHit.attr}=${quoteXpath(anchorHit.value)}]`,
        css: `${scopeCss} ${anchorCss}`
      });
    }

    const pushTargetSpecificCandidates = (axis: "/" | "//", scopedAnchorXPath: string, scopedAnchorCss: string): void => {
      const childJoin = axis === "/" ? " > " : " ";
      const targetDataTestId = target.getAttribute("data-testid")?.trim();
      if (targetDataTestId) {
        prioritizedPairs.push({
          xpath: `${scopedAnchorXPath}${axis}${targetTag}[@data-testid=${quoteXpath(targetDataTestId)}]`,
          css: `${scopedAnchorCss}${childJoin}${targetTag}[data-testid="${escapeCssValue(targetDataTestId)}"]`
        });
      }

      const targetAriaLabel = target.getAttribute("aria-label")?.trim();
      if (targetAriaLabel && targetAriaLabel.length <= 60) {
        prioritizedPairs.push({
          xpath: `${scopedAnchorXPath}${axis}${targetTag}[@aria-label=${quoteXpath(targetAriaLabel)}]`,
          css: `${scopedAnchorCss}${childJoin}${targetTag}[aria-label="${escapeCssValue(targetAriaLabel)}"]`
        });
      }

      const targetType = target.getAttribute("type")?.trim();
      if (targetType) {
        prioritizedPairs.push({
          xpath: `${scopedAnchorXPath}${axis}${targetTag}[@type=${quoteXpath(targetType)}]`,
          css: `${scopedAnchorCss}${childJoin}${targetTag}[type="${escapeCssValue(targetType)}"]`
        });
      }
    };
    const pushProductLinkCandidates = (axis: "/" | "//", scopedAnchorXPath: string, scopedAnchorCss: string): void => {
      const childJoin = axis === "/" ? " > " : " ";
      prioritizedPairs.push({
        xpath: `${scopedAnchorXPath}${axis}a[@data-testid=${quoteXpath("product-card-link")}]`,
        css: `${scopedAnchorCss}${childJoin}a[data-testid="product-card-link"]`
      });
    };
    const pushAsinHrefCandidates = (axis: "/" | "//", scopedAnchorXPath: string, scopedAnchorCss: string): void => {
      if (!/^[A-Z0-9]{10}$/.test(asin)) return;
      const dpToken = `/dp/${asin}`;
        const childJoin = axis === "/" ? " > " : " ";
        prioritizedPairs.push({
          xpath: `${scopedAnchorXPath}${axis}a[contains(@href,${quoteXpath(dpToken)})]`,
          css: `${scopedAnchorCss}${childJoin}a[href*="${escapeCssValue(dpToken)}"]`
        });
    };

    for (const scope of anchorScopes) {
      pushTargetSpecificCandidates("/", scope.xpath, scope.css);
      pushTargetSpecificCandidates("//", scope.xpath, scope.css);
      pushProductLinkCandidates("/", scope.xpath, scope.css);
      pushProductLinkCandidates("//", scope.xpath, scope.css);
      pushAsinHrefCandidates("/", scope.xpath, scope.css);
      pushAsinHrefCandidates("//", scope.xpath, scope.css);
    }

    const titleIdNode = target.querySelector("[id^='title-']");
    const titleId = titleIdNode?.getAttribute("id")?.trim();
    if (titleId) {
      prioritizedPairs.push({
        xpath: `${anchorXPath}//a[.//*[@id=${quoteXpath(titleId)}]]`,
        css: `${anchorCss} a:has(#${escapeCssIdentifier(titleId)})`
      });
    }

    prioritizedPairs.push({ xpath, css });
    for (const pair of prioritizedPairs) {
      const isUnique = mode === "xpath"
        ? evaluateXPathCount(pair.xpath, target.ownerDocument) === 1
        : evaluateCssCount(pair.css, target.ownerDocument) === 1;
      if (!isUnique) continue;

      const altUnique = mode === "xpath"
        ? evaluateCssCount(pair.css, target.ownerDocument) === 1
        : evaluateXPathCount(pair.xpath, target.ownerDocument) === 1;

      return {
        preferred: mode === "xpath" ? pair.xpath : pair.css,
        alternate: altUnique ? (mode === "xpath" ? pair.css : pair.xpath) : null,
        debug: {
          strategy: `${anchorHit.kind}_anchor_${anchor === target ? "self" : "ancestor"}`,
          anchor: `${anchorHit.attr}=${anchorHit.value}`,
          targetTag
        }
      };
    }
  }

  const rankSelector = (selector: string, selectorMode: OutputMode): number => {
    const indexPenalty = selectorMode === "xpath"
      ? (/\[\d+\]/.test(selector) ? 1000 : 0)
      : (/:nth-(?:of-type|child)\(\d+\)/.test(selector) ? 1000 : 0);
    return indexPenalty + selector.length;
  };

  const candidatePairs: Array<{ xpath: string; css: string }> = [{ xpath, css }];
  if (anchor !== target) {
    candidatePairs.push({
      xpath: `${anchorXPath}//${targetTag}`,
      css: `${anchorCss} ${targetTag}`
    });

    const targetStableAttrs = getStableAttrs(target).slice(0, 5);
    for (const hit of targetStableAttrs) {
      if (hit.attr === "href") {
        const hrefPrefix = getHrefAttributePrefix(hit.value, target.ownerDocument);
        if (hrefPrefix) {
          candidatePairs.push({
            xpath: `${anchorXPath}//${targetTag}[starts-with(@href,${quoteXpath(hrefPrefix)})]`,
            css: `${anchorCss} ${targetTag}[href^="${escapeCssValue(hrefPrefix)}"]`
          });
          continue;
        }
        const hrefContainsToken = getHrefAttributeContainsToken(hit.value, target.ownerDocument);
        if (hrefContainsToken) {
          candidatePairs.push({
            xpath: `${anchorXPath}//${targetTag}[contains(@href,${quoteXpath(hrefContainsToken)})]`,
            css: `${anchorCss} ${targetTag}[href*="${escapeCssValue(hrefContainsToken)}"]`
          });
          continue;
        }
        if (getHrefQualityTier(hit.value, target.ownerDocument) === 4) continue;
      }

      candidatePairs.push({
        xpath: `${anchorXPath}//${targetTag}[@${hit.attr}=${quoteXpath(hit.value)}]`,
        css: `${anchorCss} ${targetTag}[${hit.attr}="${escapeCssValue(hit.value)}"]`
      });
    }
  }

  const uniquePairs = candidatePairs.filter(pair => (mode === "xpath"
    ? evaluateXPathCount(pair.xpath, target.ownerDocument) === 1
    : evaluateCssCount(pair.css, target.ownerDocument) === 1));
  const bestPair = (uniquePairs.length ? uniquePairs : candidatePairs)
    .sort((a, b) => rankSelector(mode === "xpath" ? a.xpath : a.css, mode) - rankSelector(mode === "xpath" ? b.xpath : b.css, mode))[0];

  const preferred = mode === "xpath" ? bestPair.xpath : bestPair.css;
  const alternate = mode === "xpath" ? bestPair.css : bestPair.xpath;

  return {
    preferred,
    alternate,
    debug: {
      strategy: `${anchorHit.kind}_anchor_${anchor === target ? "self" : "ancestor"}`,
      anchor: `${anchorHit.attr}=${anchorHit.value}`,
      targetTag
    }
  };
}

export function buildSemanticControlSelector(target: Element, mode: OutputMode, doc: Document): SelectorResult | null {
  if (mode !== "css") return null;

  const targetSegment = buildTypedControlCss(target);
  const targetXPath = buildTypedControlXPath(target);
  const chain: Element[] = [];
  let current: Element | null = target.parentElement;
  while (current) {
    if (SEMANTIC_CONTAINER_TAGS.has(getTag(current))) chain.push(current);
    current = current.parentElement;
  }
  if (!chain.length) return null;

  const orderedAncestors = chain.reverse();
  const segments: string[] = [];
  const xpathSegments: string[] = [];

  for (const ancestor of orderedAncestors) {
    const css = buildSemanticAncestorCss(ancestor);
    const xpath = buildSemanticAncestorXPath(ancestor);
    if (!css || !xpath) continue;
    segments.push(css);
    xpathSegments.push(xpath);

    const selector = `${segments.join(" ")} ${targetSegment}`;
    if (evaluateCssCount(selector, doc) !== 1) continue;

    const xpathSelector = `${xpathSegments.join("")}${targetXPath.replace(/^\/\//, "//")}`;
    return {
      preferred: selector,
      alternate: evaluateXPathCount(xpathSelector, doc) === 1 ? xpathSelector : null,
      debug: { strategy: "semantic_control_css", anchor: selector, targetTag: getTag(target) }
    };
  }

  return null;
}

export function buildAncestorClassChainSelector(target: Element, mode: OutputMode, doc: Document): SelectorResult[] {
  if (mode !== "css") return [];
  const targetTag = getTag(target);
  const targetClassSelectors = getClassSelectorCandidates(targetTag, getStableClassNames(target), doc, "css");
  if (!targetClassSelectors.length) return [];

  const semanticSegments: string[] = [];
  const ancestorClassSegments: string[] = [];
  const results: SelectorResult[] = [];
  const seen = new Set<string>();
  let hopCount = 1;
  let current: Element | null = target.parentElement;

  while (current) {
    const semanticSegment = buildSemanticAncestorCss(current);
    if (semanticSegment && hopCount <= MAX_NEARBY_MEANINGFUL_HOPS) semanticSegments.unshift(semanticSegment);

    const ancestorTag = getTag(current);
    const ancestorClassSelectors = getClassSelectorCandidates(ancestorTag, getStableClassNames(current), doc, "css");
    if (ancestorClassSelectors.length) {
      const ancestorClassSelector = ancestorClassSelectors[0];
      const classOnlySegment = ancestorClassSelector.css.startsWith(`${ancestorTag}.`)
        ? ancestorClassSelector.css.slice(ancestorTag.length)
        : ancestorClassSelector.css;
      ancestorClassSegments.unshift(classOnlySegment);

      for (const targetClassSelector of targetClassSelectors) {
        const selector = [...semanticSegments, ...ancestorClassSegments, targetClassSelector.css].join(" ");
        if (evaluateCssCount(selector, doc) !== 1 || seen.has(selector)) continue;
        results.push({
          preferred: selector,
          alternate: targetClassSelector.xpath,
          debug: { strategy: "ancestor_class_chain_css", anchor: selector, targetTag }
        });
        seen.add(selector);
        if (results.length >= MAX_CANDIDATES_PER_PRIORITY) return results;
      }
    }

    current = current.parentElement;
    hopCount += 1;
  }

  return results;
}

export function buildDirectSemanticAttributeSelector(target: Element, mode: OutputMode, doc: Document): SelectorResult[] {
  const tag = getTag(target);
  const results: SelectorResult[] = [];

  for (const candidate of getSemanticAttributeCandidates(target)) {
    const isCssUnique = evaluateCssCount(candidate.css, doc) === 1;
    const isXPathUnique = evaluateXPathCount(candidate.xpath, doc) === 1;
    if ((mode === "css" && !isCssUnique) || (mode === "xpath" && !isXPathUnique)) continue;
    results.push({
      preferred: mode === "xpath" ? candidate.xpath : candidate.css,
      alternate: mode === "xpath" ? (isCssUnique ? candidate.css : null) : (isXPathUnique ? candidate.xpath : null),
      debug: { strategy: candidate.strategy, anchor: candidate.anchor, targetTag: tag }
    });
    if (results.length >= MAX_CANDIDATES_PER_PRIORITY) return results;
  }

  return results;
}

export function buildLabelSelector(target: Element, mode: OutputMode, doc: Document): SelectorResult | null {
  if (mode === "css") return null;
  const label = getAssociatedLabel(target);
  if (!label) return null;

  const labelText = normText(label.textContent || "");
  if (!labelText || labelText.length > 80) return null;

  const labelXPath = `//label[normalize-space(.)=${quoteXpath(labelText)}]`;
  if (evaluateXPathCount(labelXPath, doc) !== 1) return null;

  const targetTag = getTag(target);
  const targetId = target.getAttribute("id")?.trim();
  const targetName = target.getAttribute("name")?.trim();
  const targetPredicate = targetId ? `[@id=${quoteXpath(targetId)}]` : targetName ? `[@name=${quoteXpath(targetName)}]` : "";
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
    debug: { strategy: "label_anchor", anchor: labelText, targetTag }
  };
}

export function buildDirectElementSelector(target: Element, mode: OutputMode, doc: Document): SelectorResult | null {
  const targetTag = getTag(target);
  const id = target.getAttribute("id")?.trim();
  if (id && (mode !== "css" || isGoodId(id))) {
    const xpath = `//${targetTag}[@id=${quoteXpath(id)}]`;
    const css = `#${typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(id) : id}`;
    const isXPathUnique = evaluateXPathCount(xpath, doc) === 1;
    const isCssUnique = evaluateCssCount(css, doc) === 1;
    if ((mode === "xpath" && isXPathUnique) || (mode === "css" && isCssUnique)) {
      return {
        preferred: mode === "xpath" ? xpath : css,
        alternate: mode === "xpath" ? (isCssUnique ? css : null) : (isXPathUnique ? xpath : null),
        debug: { strategy: "direct_id", anchor: id, targetTag }
      };
    }
  }

  const name = target.getAttribute("name")?.trim();
  if (name) {
    const xpath = `//${targetTag}[@name=${quoteXpath(name)}]`;
    const css = `${targetTag}[name="${escapeCssValue(name)}"]`;
    const isXPathUnique = evaluateXPathCount(xpath, doc) === 1;
    const isCssUnique = evaluateCssCount(css, doc) === 1;
    if ((mode === "xpath" && isXPathUnique) || (mode === "css" && isCssUnique)) {
      return {
        preferred: mode === "xpath" ? xpath : css,
        alternate: mode === "xpath" ? (isCssUnique ? css : null) : (isXPathUnique ? xpath : null),
        debug: { strategy: "direct_name", anchor: name, targetTag }
      };
    }
  }

  return null;
}

export function buildDirectClassSelector(target: Element, mode: OutputMode, doc: Document): SelectorResult[] {
  if (mode === "xpath") return [];
  const targetTag = getTag(target);
  return getClassSelectorCandidates(targetTag, getStableClassNames(target), doc, mode)
    .slice(0, MAX_CANDIDATES_PER_PRIORITY)
    .map(candidate => ({
      preferred: candidate.css,
      alternate: candidate.xpath,
      debug: { strategy: "direct_class_combo", anchor: candidate.css, targetTag }
    }));
}

export function buildDirectLinkSelector(target: Element, mode: OutputMode, doc: Document): SelectorResult[] {
  if (getTag(target) !== "a") return [];
  const href = target.getAttribute("href")?.trim();
  if (!href) return [];

  const results: SelectorResult[] = [];
  const hrefMeta = parseHrefMeta(href, doc);
  const exactTier = getHrefQualityTier(href, doc);
  const hrefPrefix = getHrefAttributePrefix(href, doc);
  const hrefContainsToken = getHrefAttributeContainsToken(href, doc);
  const hrefSlug = hrefMeta ? getReadableSlugFromPath(hrefMeta.path) : null;
  const hrefCssFilter = getSafeCssHrefFilter(href, doc);
  const hrefCandidates: Array<{ xpath: string; css: string; strategy: string; anchor: string }> = [];
  if (hrefPrefix && hrefPrefix !== href) {
    hrefCandidates.push({
      xpath: `//a[starts-with(@href,${quoteXpath(hrefPrefix)})]`,
      css: `a[href^="${escapeCssValue(hrefPrefix)}"]`,
      strategy: "direct_href_prefix",
      anchor: hrefPrefix
    });
  }
  if (hrefContainsToken) {
    hrefCandidates.push({
      xpath: `//a[contains(@href,${quoteXpath(hrefContainsToken)})]`,
      css: `a[href*="${escapeCssValue(hrefContainsToken)}"]`,
      strategy: "direct_href_contains",
      anchor: hrefContainsToken
    });
  }
  if (exactTier <= 2) {
    hrefCandidates.push({
      xpath: `//a[@href=${quoteXpath(href)}]`,
      css: `a[href="${escapeCssValue(href)}"]`,
      strategy: "direct_href",
      anchor: href
    });
  }
  if (hrefSlug) {
    hrefCandidates.push({
      xpath: `//a[contains(@href,${quoteXpath(hrefSlug)})]`,
      css: `a[href*="${escapeCssValue(hrefSlug)}"]`,
      strategy: "direct_href_slug_contains",
      anchor: hrefSlug
    });
  }
  if (!hrefCandidates.length) return results;

  for (const hrefCandidate of hrefCandidates) {
    const isHrefXPathUnique = evaluateXPathCount(hrefCandidate.xpath, doc) === 1;
    const isHrefCssUnique = evaluateCssCount(hrefCandidate.css, doc) === 1;
    if ((mode === "xpath" && isHrefXPathUnique) || (mode === "css" && isHrefCssUnique)) {
      results.push({
        preferred: mode === "xpath" ? hrefCandidate.xpath : hrefCandidate.css,
        alternate: mode === "xpath" ? (isHrefCssUnique ? hrefCandidate.css : null) : (isHrefXPathUnique ? hrefCandidate.xpath : null),
        debug: { strategy: hrefCandidate.strategy, anchor: hrefCandidate.anchor, targetTag: "a" }
      });
      if (results.length >= MAX_CANDIDATES_PER_PRIORITY) return results;
    }
  }

  const text = normText(target.textContent || "");
  if (text && mode !== "css" && exactTier <= 2) {
    const hrefCss = `a[href="${escapeCssValue(href)}"]`;
    const hrefAndTextXPath = `//a[@href=${quoteXpath(href)} and normalize-space(.)=${quoteXpath(text)}]`;
    if (evaluateXPathCount(hrefAndTextXPath, doc) === 1) {
      results.push({ preferred: hrefAndTextXPath, alternate: hrefCss, debug: { strategy: "href_with_text", anchor: `${href} | ${text}`, targetTag: "a" } });
      if (results.length >= MAX_CANDIDATES_PER_PRIORITY) return results;
    }
  }

  const childImage = target.querySelector("img");
  if (!childImage) return results;
  if (!hrefCssFilter) return results;

  const alt = childImage.getAttribute("alt")?.trim();
  if (alt && isUsableImageAltForSelector(alt)) {
    const css = `a${hrefCssFilter}:has(img[alt="${escapeCssValue(alt)}"])`;
    if (mode === "css" && evaluateCssCount(css, doc) === 1) {
      results.push({ preferred: css, alternate: null, debug: { strategy: "href_with_img_alt", anchor: `${href} | ${alt}`, targetTag: "a" } });
      if (results.length >= MAX_CANDIDATES_PER_PRIORITY) return results;
    }
  }

  const src = childImage.getAttribute("src")?.trim();
  if (src && isUsableImageSrcForSelector(src)) {
    const css = `a${hrefCssFilter}:has(img[src="${escapeCssValue(src)}"])`;
    if (mode === "css" && evaluateCssCount(css, doc) === 1) {
      results.push({ preferred: css, alternate: null, debug: { strategy: "href_with_img_src", anchor: `${href} | ${src}`, targetTag: "a" } });
    }
  }

  return results;
}

function getLinkCssCandidates(link: Element, doc: Document): string[] {
  return buildDirectLinkSelector(link, "css", doc)
    .map(candidate => candidate.preferred)
    .filter(selector => evaluateCssCount(selector, doc) === 1)
    .slice(0, MAX_CANDIDATES_PER_PRIORITY);
}

function getLocalTargetCssSegments(target: Element, doc: Document): string[] {
  const tag = getTag(target);
  const segments: string[] = [];
  const seen = new Set<string>();

  for (const candidate of getClassSelectorCandidates(tag, getStableClassNames(target), doc, "css").map(candidate => candidate.css)) {
    if (seen.has(candidate)) continue;
    segments.push(candidate);
    seen.add(candidate);
    if (segments.length >= MAX_CANDIDATES_PER_PRIORITY) return segments;
  }

  const stableClasses = getStableClassNames(target);
  if (stableClasses.length) {
    const singleClass = `${tag}.${escapeCssIdentifier(stableClasses[0])}`;
    if (!seen.has(singleClass)) {
      segments.push(singleClass);
      seen.add(singleClass);
      if (segments.length >= MAX_CANDIDATES_PER_PRIORITY) return segments;
    }
  }

  for (const hit of getStableAttrs(target).filter(hit => hit.kind === "generic")) {
    if (hit.attr === "href") {
      const hrefPrefix = getHrefAttributePrefix(hit.value, doc);
      const hrefContainsToken = getHrefAttributeContainsToken(hit.value, doc);
      if (hrefPrefix) {
        const prefixCandidate = `${tag}[href^="${escapeCssValue(hrefPrefix)}"]`;
        if (!seen.has(prefixCandidate)) {
          segments.push(prefixCandidate);
          seen.add(prefixCandidate);
          if (segments.length >= MAX_CANDIDATES_PER_PRIORITY) return segments;
        }
        continue;
      }
      if (hrefContainsToken) {
        const containsCandidate = `${tag}[href*="${escapeCssValue(hrefContainsToken)}"]`;
        if (!seen.has(containsCandidate)) {
          segments.push(containsCandidate);
          seen.add(containsCandidate);
          if (segments.length >= MAX_CANDIDATES_PER_PRIORITY) return segments;
        }
        continue;
      }

      if (getHrefQualityTier(hit.value, doc) === 4) continue;
    }

    const candidate = buildTaggedAttrCss(tag, hit.attr, hit.value);
    if (seen.has(candidate)) continue;
    segments.push(candidate);
    seen.add(candidate);
    if (segments.length >= MAX_CANDIDATES_PER_PRIORITY) return segments;
  }

  if (!seen.has(tag)) segments.push(tag);
  return segments;
}

export function buildLinkContentSelector(target: Element, mode: OutputMode, doc: Document): SelectorResult[] {
  if (mode !== "css" || getTag(target) !== "a") return [];
  const href = target.getAttribute("href")?.trim();
  if (!href) return [];
  const hrefPrefix = getHrefAttributePrefix(href, doc);
  const hrefContainsToken = getHrefAttributeContainsToken(href, doc);
  if (getHrefQualityTier(href, doc) === 4 && !hrefPrefix && !hrefContainsToken) return [];
  const hrefFilter = hrefPrefix
    ? `[href^="${escapeCssValue(hrefPrefix)}"]`
    : hrefContainsToken
      ? `[href*="${escapeCssValue(hrefContainsToken)}"]`
      : `[href="${escapeCssValue(href)}"]`;

  const targetSegments = getLocalTargetCssSegments(target, doc);
  if (!targetSegments.length) return [];

  const results: SelectorResult[] = [];
  const seen = new Set<string>();
  let current: Element | null = target.parentElement;
  let hopCount = 1;
  const deferredDivContainers: Element[] = [];

  while (current && hopCount <= MAX_CONTENT_LINK_HOPS) {
    const containerTag = getTag(current);
    if (CONTENT_CONTAINER_TAGS.has(containerTag)) {
      if (containerTag === "div") {
        deferredDivContainers.push(current);
      } else {
        const containerSegments = [containerTag];
        if (current.querySelector(":scope > .content")) containerSegments.push(`${containerTag} .content`);

        for (const containerSegment of containerSegments) {
          for (const targetSegment of targetSegments) {
            const hrefSelector = `${containerSegment} ${targetSegment}${hrefFilter}`;
            if (!seen.has(hrefSelector) && evaluateCssCount(hrefSelector, doc) === 1) {
              results.push({ preferred: hrefSelector, alternate: null, debug: { strategy: "link_content_css", anchor: hrefSelector, targetTag: "a" } });
              seen.add(hrefSelector);
              if (results.length >= MAX_CANDIDATES_PER_PRIORITY) return results;
            }

            const hasSelector = `${containerTag}:has(a${hrefFilter}) ${targetSegment}`;
            if (!seen.has(hasSelector) && evaluateCssCount(hasSelector, doc) === 1) {
              results.push({ preferred: hasSelector, alternate: null, debug: { strategy: "link_content_has_css", anchor: hasSelector, targetTag: "a" } });
              seen.add(hasSelector);
              if (results.length >= MAX_CANDIDATES_PER_PRIORITY) return results;
            }
          }
        }
      }
    }

    current = current.parentElement;
    hopCount += 1;
  }

  for (const divContainer of deferredDivContainers) {
    const containerTag = getTag(divContainer);
    const containerSegments = [containerTag];
    if (divContainer.querySelector(":scope > .content")) containerSegments.push(`${containerTag} .content`);

    for (const containerSegment of containerSegments) {
      for (const targetSegment of targetSegments) {
        const hrefSelector = `${containerSegment} ${targetSegment}${hrefFilter}`;
        if (!seen.has(hrefSelector) && evaluateCssCount(hrefSelector, doc) === 1) {
          results.push({ preferred: hrefSelector, alternate: null, debug: { strategy: "link_content_css", anchor: hrefSelector, targetTag: "a" } });
          seen.add(hrefSelector);
          if (results.length >= MAX_CANDIDATES_PER_PRIORITY) return results;
        }

        const hasSelector = `${containerTag}:has(a${hrefFilter}) ${targetSegment}`;
        if (!seen.has(hasSelector) && evaluateCssCount(hasSelector, doc) === 1) {
          results.push({ preferred: hasSelector, alternate: null, debug: { strategy: "link_content_has_css", anchor: hasSelector, targetTag: "a" } });
          seen.add(hasSelector);
          if (results.length >= MAX_CANDIDATES_PER_PRIORITY) return results;
        }
      }
    }
  }

  return results;
}

export function buildContentBlockLinkAnchorSelector(target: Element, mode: OutputMode, doc: Document): SelectorResult[] {
  if (mode !== "css") return [];
  const targetSegments = getLocalTargetCssSegments(target, doc);
  if (!targetSegments.length) return [];

  const results: SelectorResult[] = [];
  const seen = new Set<string>();

  for (const container of getLocalContentContainers(target, MAX_CONTENT_LINK_HOPS)) {
    const containerTag = getTag(container);
    const links = Array.from(container.querySelectorAll("a[href]"))
      .filter((link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement)
      .filter(link => link.href.trim().length > 0);

    for (const link of links) {
      for (const linkSelector of getLinkCssCandidates(link, doc)) {
        for (const targetSegment of targetSegments) {
          const selector = `${containerTag}:has(${linkSelector}) ${targetSegment}`;
          if (seen.has(selector) || evaluateCssCount(selector, doc) !== 1) continue;
          results.push({ preferred: selector, alternate: null, debug: { strategy: "content_block_link_anchor_css", anchor: selector, targetTag: getTag(target) } });
          seen.add(selector);
          if (results.length >= MAX_CANDIDATES_PER_PRIORITY) return results;
        }
      }
    }
  }

  return results;
}

export function buildInlineLinkAnchorSelector(target: Element, mode: OutputMode, doc: Document): SelectorResult[] {
  const targetTag = getTag(target);
  if (!["p", "div", "span", "li"].includes(targetTag)) return [];

  const links = Array.from(target.querySelectorAll("a[href]"))
    .filter((link): link is HTMLAnchorElement => link instanceof HTMLAnchorElement)
    .filter(link => link.getAttribute("href")?.trim());
  if (!links.length) return [];

  const results: SelectorResult[] = [];
  const seen = new Set<string>();

  for (const link of links) {
    const linkCandidates = buildDirectLinkSelector(link, mode, doc);
    for (const linkCandidate of linkCandidates) {
      const href = link.getAttribute("href")?.trim();
      if (!href) continue;
      const hasFallbackHrefAnchor = Boolean(getHrefAttributePrefix(href, doc) || getHrefAttributeContainsToken(href, doc));
      if (getHrefQualityTier(href, doc) === 4 && !hasFallbackHrefAnchor) continue;

      const css = `${targetTag}:has(a[href="${escapeCssValue(href)}"])`;
      const xpath = `//${targetTag}[.//a[@href=${quoteXpath(href)}]]`;
      const selector = mode === "xpath" ? xpath : css;
      const key = `${mode}:${selector}`;
      if (seen.has(key)) continue;

      const isUnique = mode === "xpath"
        ? evaluateXPathCount(xpath, doc) === 1
        : evaluateCssCount(css, doc) === 1;
      if (!isUnique) continue;

      results.push({
        preferred: selector,
        alternate: mode === "xpath" ? (evaluateCssCount(css, doc) === 1 ? css : null) : (evaluateXPathCount(xpath, doc) === 1 ? xpath : null),
        debug: { strategy: "inline_link_anchor", anchor: linkCandidate.preferred, targetTag }
      });
      seen.add(key);
      if (results.length >= MAX_CANDIDATES_PER_PRIORITY) return results;
    }
  }

  return results;
}

export function buildDirectGenericSelector(target: Element, mode: OutputMode, doc: Document): SelectorResult | null {
  const targetTag = getTag(target);
  const attrPriority: Record<string, number> = { "aria-label": 0, title: 1, placeholder: 2, alt: 3, href: 4, src: 5 };
  const attrs = getStableAttrs(target).filter(hit => hit.kind === "generic").sort((a, b) => (attrPriority[a.attr] ?? 99) - (attrPriority[b.attr] ?? 99));

  for (const hit of attrs) {
    if (hit.attr === "href") {
      const hasFallbackHrefAnchor = Boolean(getHrefAttributePrefix(hit.value, doc) || getHrefAttributeContainsToken(hit.value, doc));
      if (getHrefQualityTier(hit.value, doc) === 4 && !hasFallbackHrefAnchor) continue;
    }
    const xpath = buildAttrXPath(targetTag, hit.attr, hit.value);
    const css = buildTaggedAttrCss(targetTag, hit.attr, hit.value);
    const isXPathUnique = evaluateXPathCount(xpath, doc) === 1;
    const isCssUnique = evaluateCssCount(css, doc) === 1;
    if ((mode === "xpath" && isXPathUnique) || (mode === "css" && isCssUnique)) {
      return {
        preferred: mode === "xpath" ? xpath : css,
        alternate: mode === "xpath" ? (isCssUnique ? css : null) : (isXPathUnique ? xpath : null),
        debug: { strategy: `direct_${hit.attr}`, anchor: `${hit.attr}=${hit.value}`, targetTag }
      };
    }
  }

  return null;
}

export function buildUniqueAncestorTagSelector(target: Element, mode: OutputMode, doc: Document): SelectorResult | null {
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
      if (mode === "xpath" && /\[\d+\]/.test(relXPath)) {
        current = current.parentElement;
        hopCount += 1;
        continue;
      }

      const xpath = relXPath === "." ? ancestorXPath : `${ancestorXPath}${relXPath.slice(1)}`;
      if (evaluateXPathCount(xpath, doc) === 1) {
        const relCss = buildDescendantCss(current, target);
        if (mode === "css" && relCss?.includes(":nth-of-type(")) {
          current = current.parentElement;
          hopCount += 1;
          continue;
        }
        const css = relCss ? `${ancestorTag} ${relCss}` : ancestorTag;
        return { preferred: mode === "xpath" ? xpath : css, alternate: mode === "xpath" ? css : xpath, debug: { strategy: "unique_ancestor_tag", anchor: ancestorTag, targetTag: getTag(target) } };
      }
    }

    current = current.parentElement;
    hopCount += 1;
  }

  return null;
}

export function buildTextFallback(target: Element, mode: OutputMode, doc: Document): SelectorResult | null {
  if (mode === "css") return null;

  const text = normText(target.textContent || "");
  if (!text || text.length > 60) return null;
  if (text.length < 2) return null;
  if (/^\d+(?:[.,]\d+)?\+?$/.test(text)) return null;
  if (/^[^\p{L}\p{N}]+$/u.test(text)) return null;
  if (!/\p{L}/u.test(text) && text.length < 4) return null;
  if (/^(?:next|prev|previous|more|less|new|hot)$/i.test(text)) return null;

  const targetTag = getTag(target);
  const exactByTag = `//${targetTag}[normalize-space(.)=${quoteXpath(text)}]`;
  if (evaluateXPathCount(exactByTag, doc) === 1) {
    return { preferred: exactByTag, alternate: targetTag, debug: { strategy: "text_fallback_tag_exact", anchor: text, targetTag } };
  }

  const exactAny = `//*[normalize-space(.)=${quoteXpath(text)}]`;
  if (evaluateXPathCount(exactAny, doc) !== 1) return null;
  return { preferred: exactAny, alternate: targetTag, debug: { strategy: "text_fallback", anchor: text, targetTag } };
}
