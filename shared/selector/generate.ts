import { MAX_CANDIDATES_PER_PRIORITY, MAX_DATA_HOPS, MAX_GENERIC_HOPS, MAX_TEST_HOPS } from "./constants";
import { evaluateModeCount, findNearbyAnchor, getInteractiveRoot, getUniqueStableAttr, withEvaluationCache } from "./dom";
import {
  buildAncestorClassChainSelector,
  buildContentBlockLinkAnchorSelector,
  buildDirectClassSelector,
  buildDirectElementSelector,
  buildDirectGenericSelector,
  buildDirectLinkSelector,
  buildDirectSemanticAttributeSelector,
  buildFromAnchor,
  buildInlineLinkAnchorSelector,
  buildLabelSelector,
  buildLinkContentSelector,
  buildSemanticControlSelector,
  buildTextFallback,
  buildUniqueAncestorTagSelector
} from "./strategies";
import type { OutputMode, RankedSelectorOption, SelectorResult } from "./types";

type PrioritizedSelectorResult = SelectorResult & {
  mode: OutputMode;
  priority: number;
};

function isListHasSelector(selector: string, mode: OutputMode): boolean {
  return mode === "css" && /^\s*li:has\(/i.test(selector);
}

function countXPathIndexSteps(selector: string): number {
  const matches = selector.match(/\/[a-zA-Z*][^/\[]*\[(\d+)\]/g) ?? [];
  return matches.length;
}

function countCssIndexSteps(selector: string): number {
  const nthOfTypeMatches = selector.match(/:nth-of-type\((\d+)\)/g) ?? [];
  const nthChildMatches = selector.match(/:nth-child\((\d+)\)/g) ?? [];
  return nthOfTypeMatches.length + nthChildMatches.length;
}

function getStrategyReadabilityPenalty(strategy: string): number {
  switch (strategy) {
    case "direct_id":
      return -35;
    case "direct_name":
      return -15;
    case "label_anchor":
      return -10;
    case "direct_title":
      return 20;
    case "direct_alt":
      return 20;
    case "direct_placeholder":
      return 25;
    case "direct_src":
      return 35;
    case "ancestor_class_chain_css":
      return 45;
    case "direct_class_combo":
      return 30;
    case "link_content_css":
      return 40;
    case "direct_href_slug_contains":
      return 60;
    case "inline_link_anchor":
      return 65;
    case "content_block_link_anchor_css":
      return 70;
    case "link_content_has_css":
      return 85;
    case "text_fallback_tag_exact":
    case "text_fallback":
      return 130;
    default:
      return 0;
  }
}

function getReadabilityScore(candidate: PrioritizedSelectorResult): number {
  const selector = candidate.preferred;
  const hopCount = getHopCount(selector, candidate.mode);
  const indexStepCount = candidate.mode === "xpath" ? countXPathIndexSteps(selector) : countCssIndexSteps(selector);
  const hasPseudoCount = candidate.mode === "css" ? (selector.match(/:has\(/g) ?? []).length : 0;
  const classTokenCount = candidate.mode === "css" ? (selector.match(/\.[a-zA-Z0-9_-]+/g) ?? []).length : 0;
  const textMatchCount = candidate.mode === "xpath" ? (selector.match(/normalize-space\(\.\)/g) ?? []).length : 0;
  const attributeAnchorCount = candidate.mode === "xpath"
    ? (selector.match(/@[\w:-]+=/g) ?? []).length
    : (selector.match(/\[[^\]]+\]/g) ?? []).length + (selector.includes("#") ? 1 : 0);

  const score = selector.length
    + hopCount * 14
    + indexStepCount * 30
    + hasPseudoCount * 40
    + classTokenCount * 6
    + textMatchCount * 20
    - attributeAnchorCount * 8
    + getStrategyReadabilityPenalty(candidate.debug.strategy);

  return Math.max(0, score);
}

function hasScopedAnchor(selector: string, mode: OutputMode): boolean {
  if (mode === "xpath") {
    return /@id=|@href=|@data-[a-z0-9_-]+=/.test(selector);
  }

  return /#|(?:^|[\s>+~])\w+\[href=|(?:^|[\s>+~])\w+\[data-[a-z0-9_-]+=/.test(selector);
}

function usesOnlyFirstIndex(selector: string, mode: OutputMode): boolean {
  if (mode === "xpath") {
    const indexes = Array.from(selector.matchAll(/\/[a-zA-Z*][^/\[]*\[(\d+)\]/g)).map(match => Number(match[1]));
    return indexes.every(index => index === 1);
  }

  const indexes = Array.from(selector.matchAll(/:nth-(?:of-type|child)\((\d+)\)/g)).map(match => Number(match[1]));
  return indexes.every(index => index === 1);
}

function getHopCount(selector: string, mode: OutputMode): number {
  if (mode === "xpath") return (selector.match(/\//g) ?? []).length;
  return (selector.match(/[> ]/g) ?? []).length + 1;
}

function isIndexedFallbackAcceptable(candidate: PrioritizedSelectorResult, hasHigherAcceptedCandidate: boolean): boolean {
  const selector = candidate.preferred;
  const indexStepCount = candidate.mode === "xpath" ? countXPathIndexSteps(selector) : countCssIndexSteps(selector);
  if (indexStepCount === 0) return true;
  if (hasHigherAcceptedCandidate) return false;
  if (!hasScopedAnchor(selector, candidate.mode)) return false;
  if (indexStepCount > 1) return false;
  if (!usesOnlyFirstIndex(selector, candidate.mode)) return false;
  if (candidate.mode === "xpath" && /preceding-sibling|following-sibling/.test(selector)) return false;
  if (getHopCount(selector, candidate.mode) > 6) return false;
  if (selector.length > 120) return false;
  return true;
}

function compareCandidates(a: PrioritizedSelectorResult, b: PrioritizedSelectorResult, preferredMode: OutputMode): number {
  if (a.mode !== b.mode) {
    if (a.mode === preferredMode) return -1;
    if (b.mode === preferredMode) return 1;
  }

  if (a.preferred.length !== b.preferred.length) return a.preferred.length - b.preferred.length;
  if (a.mode !== b.mode) return a.mode === "css" ? -1 : 1;
  return a.preferred.localeCompare(b.preferred);
}

function compareCandidatesWithinMode(a: PrioritizedSelectorResult, b: PrioritizedSelectorResult): number {
  const readability = getReadabilityScore(a) - getReadabilityScore(b);
  if (readability !== 0) return readability;
  if (a.preferred.length !== b.preferred.length) return a.preferred.length - b.preferred.length;
  return a.preferred.localeCompare(b.preferred);
}

function collectCandidates(target: Element, mode: OutputMode, doc: Document): PrioritizedSelectorResult[] {
  const candidates: PrioritizedSelectorResult[] = [];

  const pushCandidates = (priority: number, next: SelectorResult | SelectorResult[] | null): void => {
    const getAdjustedPriority = (candidate: SelectorResult): number => {
      // Keep generic slug href matching as a true fallback even though it's built
      // by the direct-link strategy pipeline.
      if (candidate.debug.strategy === "direct_href_slug_contains") return 16;
      return priority;
    };

    if (!next) return;
    if (Array.isArray(next)) {
      for (const candidate of next.slice(0, MAX_CANDIDATES_PER_PRIORITY)) {
        candidates.push({ ...candidate, mode, priority: getAdjustedPriority(candidate) });
      }
      return;
    }
    candidates.push({ ...next, mode, priority: getAdjustedPriority(next) });
  };

  const directGenericSelector = buildDirectGenericSelector(target, mode, doc);
  const highPriorityGenericSelector = directGenericSelector?.debug.strategy === "direct_title" ? directGenericSelector : null;
  const lowPriorityGenericSelector = directGenericSelector?.debug.strategy === "direct_title" ? null : directGenericSelector;

  const directTest = getUniqueStableAttr(target, doc, "test");
  if (directTest && directTest.kind === "test") pushCandidates(0, buildFromAnchor(target, directTest, target, mode));

  const nearbyTestAnchor = findNearbyAnchor(target, doc, MAX_TEST_HOPS, "test");
  if (nearbyTestAnchor) pushCandidates(1, buildFromAnchor(nearbyTestAnchor.el, nearbyTestAnchor.hit, target, mode));

  const nearbyDataAnchor = findNearbyAnchor(target, doc, MAX_DATA_HOPS, "data");
  if (nearbyDataAnchor) pushCandidates(2, buildFromAnchor(nearbyDataAnchor.el, nearbyDataAnchor.hit, target, mode));

  pushCandidates(3, buildDirectElementSelector(target, mode, doc));
  pushCandidates(4, buildDirectSemanticAttributeSelector(target, mode, doc));
  pushCandidates(5, highPriorityGenericSelector);
  pushCandidates(6, buildDirectLinkSelector(target, mode, doc));
  pushCandidates(7, buildDirectClassSelector(target, mode, doc));
  pushCandidates(8, buildUniqueAncestorTagSelector(target, mode, doc));
  pushCandidates(9, buildAncestorClassChainSelector(target, mode, doc));
  pushCandidates(10, buildLabelSelector(target, mode, doc));
  pushCandidates(11, lowPriorityGenericSelector);
  pushCandidates(12, buildSemanticControlSelector(target, mode, doc));
  pushCandidates(13, buildInlineLinkAnchorSelector(target, mode, doc));
  pushCandidates(14, buildLinkContentSelector(target, mode, doc));
  pushCandidates(15, buildContentBlockLinkAnchorSelector(target, mode, doc));

  const nearbyGenericAnchor = findNearbyAnchor(target, doc, MAX_GENERIC_HOPS, "generic");
  if (nearbyGenericAnchor) pushCandidates(16, buildFromAnchor(nearbyGenericAnchor.el, nearbyGenericAnchor.hit, target, mode));
  pushCandidates(17, buildTextFallback(target, mode, doc));

  const accepted: PrioritizedSelectorResult[] = [];
  for (const candidate of candidates) {
    if (evaluateModeCount(candidate.preferred, mode, doc) !== 1) continue;
    if (!isIndexedFallbackAcceptable(candidate, accepted.length > 0)) continue;
    accepted.push(candidate);
  }

  accepted.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return compareCandidatesWithinMode(a, b);
  });

  return accepted;
}

export function generateSelectors(clicked: Element, mode: OutputMode, doc: Document): SelectorResult | null {
  return withEvaluationCache(() => {
    const target = getInteractiveRoot(clicked);
    const candidates = collectCandidates(target, mode, doc);

    for (const candidate of candidates) {
      if (evaluateModeCount(candidate.preferred, mode, doc) === 1) {
        return {
          preferred: candidate.preferred,
          alternate: candidate.alternate,
          debug: candidate.debug
        };
      }
    }

    return null;
  });
}

export function generateRankedSelectorOptions(clicked: Element, preferredMode: OutputMode, doc: Document, limit = 4): RankedSelectorOption[] {
  return withEvaluationCache(() => {
    const target = getInteractiveRoot(clicked);
    const combined = collectCandidates(target, preferredMode, doc);

    const byPriority = new Map<number, PrioritizedSelectorResult[]>();
    for (const candidate of combined) {
      const current = byPriority.get(candidate.priority) ?? [];
      current.push(candidate);
      byPriority.set(candidate.priority, current);
    }

    const ranked: RankedSelectorOption[] = [];
    const seen = new Set<string>();
    const priorities = Array.from(byPriority.keys()).sort((a, b) => a - b);
    const startPriority = priorities.find(priority =>
      (byPriority.get(priority) ?? []).some(candidate => candidate.mode === preferredMode)
    );

    const effectiveStartPriority = startPriority ?? priorities[0];
    if (effectiveStartPriority == null) return ranked;

    const appendCandidate = (candidate: PrioritizedSelectorResult | undefined): void => {
      if (!candidate) return;
      const key = `${candidate.mode}:${candidate.preferred}`;
      if (seen.has(key)) return;
      ranked.push({
        selector: candidate.preferred,
        mode: candidate.mode,
        priority: candidate.priority,
        debug: candidate.debug
      });
      seen.add(key);
    };

    for (const priority of priorities) {
      if (priority < effectiveStartPriority) continue;

      const preferredCandidates = (byPriority.get(priority) ?? [])
        .filter(candidate => !seen.has(`${candidate.mode}:${candidate.preferred}`))
        .sort(compareCandidatesWithinMode);
      appendCandidate(preferredCandidates[0]);
      if (ranked.length >= limit) break;
    }

    if (ranked.length > 1 && isListHasSelector(ranked[0].selector, ranked[0].mode)) {
      const betterPrimaryIndex = ranked.findIndex((candidate, index) =>
        index > 0
        && candidate.mode === ranked[0].mode
        && !isListHasSelector(candidate.selector, candidate.mode)
      );
      if (betterPrimaryIndex > 0) {
        const listHasPrimary = ranked[0];
        ranked[0] = ranked[betterPrimaryIndex];
        ranked[betterPrimaryIndex] = listHasPrimary;
      }
    }

    return ranked;
  });
}
