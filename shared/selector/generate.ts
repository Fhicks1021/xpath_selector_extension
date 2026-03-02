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
  buildLabelSelector,
  buildLinkContentSelector,
  buildSemanticControlSelector,
  buildTextFallback,
  buildUniqueAncestorTagSelector
} from "./strategies";
import type { OutputMode, SelectorResult } from "./types";

export function generateSelectors(clicked: Element, mode: OutputMode, doc: Document): SelectorResult | null {
  return withEvaluationCache(() => {
    const target = getInteractiveRoot(clicked);
    const candidates: Array<SelectorResult | null> = [];

    const pushCandidates = (next: SelectorResult | SelectorResult[] | null): void => {
      if (!next) return;
      if (Array.isArray(next)) {
        for (const candidate of next.slice(0, MAX_CANDIDATES_PER_PRIORITY)) candidates.push(candidate);
        return;
      }
      candidates.push(next);
    };

    const directTest = getUniqueStableAttr(target, doc, "test");
    if (directTest && directTest.kind === "test") pushCandidates(buildFromAnchor(target, directTest, target, mode));

    const nearbyTestAnchor = findNearbyAnchor(target, doc, MAX_TEST_HOPS, "test");
    if (nearbyTestAnchor) pushCandidates(buildFromAnchor(nearbyTestAnchor.el, nearbyTestAnchor.hit, target, mode));

    const nearbyDataAnchor = findNearbyAnchor(target, doc, MAX_DATA_HOPS, "data");
    if (nearbyDataAnchor) pushCandidates(buildFromAnchor(nearbyDataAnchor.el, nearbyDataAnchor.hit, target, mode));

    pushCandidates(buildDirectElementSelector(target, mode, doc));
    pushCandidates(buildDirectSemanticAttributeSelector(target, mode, doc));
    pushCandidates(buildSemanticControlSelector(target, mode, doc));
    pushCandidates(buildDirectLinkSelector(target, mode, doc));
    pushCandidates(buildLinkContentSelector(target, mode, doc));
    pushCandidates(buildContentBlockLinkAnchorSelector(target, mode, doc));
    pushCandidates(buildAncestorClassChainSelector(target, mode, doc));
    pushCandidates(buildDirectClassSelector(target, mode, doc));
    pushCandidates(buildDirectGenericSelector(target, mode, doc));
    pushCandidates(buildLabelSelector(target, mode, doc));

    const nearbyGenericAnchor = findNearbyAnchor(target, doc, MAX_GENERIC_HOPS, "generic");
    if (nearbyGenericAnchor) pushCandidates(buildFromAnchor(nearbyGenericAnchor.el, nearbyGenericAnchor.hit, target, mode));

    pushCandidates(buildUniqueAncestorTagSelector(target, mode, doc));
    pushCandidates(buildTextFallback(target, mode, doc));

    for (const candidate of candidates) {
      if (!candidate) continue;
      if (evaluateModeCount(candidate.preferred, mode, doc) === 1) return candidate;
    }

    return null;
  });
}
