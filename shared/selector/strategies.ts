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
  const hrefXPath = `//a[@href=${quoteXpath(href)}]`;
  const hrefCss = `a[href="${escapeCssValue(href)}"]`;
  const isHrefXPathUnique = evaluateXPathCount(hrefXPath, doc) === 1;
  const isHrefCssUnique = evaluateCssCount(hrefCss, doc) === 1;
  if ((mode === "xpath" && isHrefXPathUnique) || (mode === "css" && isHrefCssUnique)) {
    results.push({
      preferred: mode === "xpath" ? hrefXPath : hrefCss,
      alternate: mode === "xpath" ? (isHrefCssUnique ? hrefCss : null) : (isHrefXPathUnique ? hrefXPath : null),
      debug: { strategy: "direct_href", anchor: href, targetTag: "a" }
    });
    if (results.length >= MAX_CANDIDATES_PER_PRIORITY) return results;
  }

  const text = normText(target.textContent || "");
  if (text && mode !== "css") {
    const hrefAndTextXPath = `//a[@href=${quoteXpath(href)} and normalize-space(.)=${quoteXpath(text)}]`;
    if (evaluateXPathCount(hrefAndTextXPath, doc) === 1) {
      results.push({ preferred: hrefAndTextXPath, alternate: hrefCss, debug: { strategy: "href_with_text", anchor: `${href} | ${text}`, targetTag: "a" } });
      if (results.length >= MAX_CANDIDATES_PER_PRIORITY) return results;
    }
  }

  const childImage = target.querySelector("img");
  if (!childImage) return results;

  const alt = childImage.getAttribute("alt")?.trim();
  if (alt) {
    const css = `a[href="${escapeCssValue(href)}"]:has(img[alt="${escapeCssValue(alt)}"])`;
    if (mode === "css" && evaluateCssCount(css, doc) === 1) {
      results.push({ preferred: css, alternate: null, debug: { strategy: "href_with_img_alt", anchor: `${href} | ${alt}`, targetTag: "a" } });
      if (results.length >= MAX_CANDIDATES_PER_PRIORITY) return results;
    }
  }

  const src = childImage.getAttribute("src")?.trim();
  if (src) {
    const css = `a[href="${escapeCssValue(href)}"]:has(img[src="${escapeCssValue(src)}"])`;
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
            const hrefSelector = `${containerSegment} ${targetSegment}[href="${escapeCssValue(href)}"]`;
            if (!seen.has(hrefSelector) && evaluateCssCount(hrefSelector, doc) === 1) {
              results.push({ preferred: hrefSelector, alternate: null, debug: { strategy: "link_content_css", anchor: hrefSelector, targetTag: "a" } });
              seen.add(hrefSelector);
              if (results.length >= MAX_CANDIDATES_PER_PRIORITY) return results;
            }

            const hasSelector = `${containerTag}:has(a[href="${escapeCssValue(href)}"]) ${targetSegment}`;
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
        const hrefSelector = `${containerSegment} ${targetSegment}[href="${escapeCssValue(href)}"]`;
        if (!seen.has(hrefSelector) && evaluateCssCount(hrefSelector, doc) === 1) {
          results.push({ preferred: hrefSelector, alternate: null, debug: { strategy: "link_content_css", anchor: hrefSelector, targetTag: "a" } });
          seen.add(hrefSelector);
          if (results.length >= MAX_CANDIDATES_PER_PRIORITY) return results;
        }

        const hasSelector = `${containerTag}:has(a[href="${escapeCssValue(href)}"]) ${targetSegment}`;
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

  const targetTag = getTag(target);
  const exactByTag = `//${targetTag}[normalize-space(.)=${quoteXpath(text)}]`;
  if (evaluateXPathCount(exactByTag, doc) === 1) {
    return { preferred: exactByTag, alternate: targetTag, debug: { strategy: "text_fallback_tag_exact", anchor: text, targetTag } };
  }

  const exactAny = `//*[normalize-space(.)=${quoteXpath(text)}]`;
  if (evaluateXPathCount(exactAny, doc) !== 1) return null;
  return { preferred: exactAny, alternate: targetTag, debug: { strategy: "text_fallback", anchor: text, targetTag } };
}
