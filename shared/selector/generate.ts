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

function countXPathIndexSteps(selector: string): number {
  const matches = selector.match(/\/[a-zA-Z*][^/\[]*\[(\d+)\]/g) ?? [];
  return matches.length;
}

function countCssIndexSteps(selector: string): number {
  const nthOfTypeMatches = selector.match(/:nth-of-type\((\d+)\)/g) ?? [];
  const nthChildMatches = selector.match(/:nth-child\((\d+)\)/g) ?? [];
  return nthOfTypeMatches.length + nthChildMatches.length;
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
  if (a.preferred.length !== b.preferred.length) return a.preferred.length - b.preferred.length;
  return a.preferred.localeCompare(b.preferred);
}

function collectCandidates(target: Element, mode: OutputMode, doc: Document): PrioritizedSelectorResult[] {
  const candidates: PrioritizedSelectorResult[] = [];

  const pushCandidates = (priority: number, next: SelectorResult | SelectorResult[] | null): void => {
    if (!next) return;
    if (Array.isArray(next)) {
      for (const candidate of next.slice(0, MAX_CANDIDATES_PER_PRIORITY)) {
        candidates.push({ ...candidate, mode, priority });
      }
      return;
    }
    candidates.push({ ...next, mode, priority });
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
  pushCandidates(7, buildLinkContentSelector(target, mode, doc));
  pushCandidates(8, buildInlineLinkAnchorSelector(target, mode, doc));
  pushCandidates(9, buildContentBlockLinkAnchorSelector(target, mode, doc));
  pushCandidates(10, buildAncestorClassChainSelector(target, mode, doc));
  pushCandidates(11, buildUniqueAncestorTagSelector(target, mode, doc));
  pushCandidates(12, buildTextFallback(target, mode, doc));
  pushCandidates(13, buildDirectClassSelector(target, mode, doc));
  pushCandidates(14, buildLabelSelector(target, mode, doc));
  pushCandidates(15, lowPriorityGenericSelector);
  pushCandidates(16, buildSemanticControlSelector(target, mode, doc));

  const nearbyGenericAnchor = findNearbyAnchor(target, doc, MAX_GENERIC_HOPS, "generic");
  if (nearbyGenericAnchor) pushCandidates(17, buildFromAnchor(nearbyGenericAnchor.el, nearbyGenericAnchor.hit, target, mode));

  const accepted: PrioritizedSelectorResult[] = [];
  for (const candidate of candidates) {
    if (evaluateModeCount(candidate.preferred, mode, doc) !== 1) continue;
    if (!isIndexedFallbackAcceptable(candidate, accepted.length > 0)) continue;
    accepted.push(candidate);
  }

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

    return ranked;
  });
}
