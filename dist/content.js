"use strict";
(() => {
  // shared/selector.ts
  var TEST_ATTRS = ["data-test", "data-testid", "data-test-id", "data-qa", "data-cy"];
  function normText(s) {
    return s.trim().replace(/\s+/g, " ");
  }
  function quoteXpath(text) {
    if (!text.includes("'")) return `'${text}'`;
    const parts = text.split("'").map((p) => `'${p}'`);
    return `concat(${parts.join(`, "'", `)})`;
  }
  function getTag(el) {
    return el.tagName.toLowerCase();
  }
  function getTestAttr(el) {
    for (const a of TEST_ATTRS) {
      const v = el.getAttribute(a);
      if (v && v.trim()) return { attr: a, value: v.trim() };
    }
    return null;
  }
  function cssByAttr(attr, value) {
    const safe = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `[${attr}="${safe}"]`;
  }
  function xpathByAttr(tag, attr, value) {
    return `//${tag}[@${attr}=${quoteXpath(value)}]`;
  }
  function evaluateXPathCount(xpath, doc) {
    try {
      const res = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return res.snapshotLength;
    } catch {
      return 0;
    }
  }
  function findNearestTestAnchor(target, maxHops) {
    let cur = target;
    for (let hop = 0; hop <= maxHops; hop++) {
      if (!cur) break;
      const hit = getTestAttr(cur);
      if (hit) return { el: cur, hop, hit };
      cur = cur.parentElement;
    }
    return null;
  }
  function findLabelTextCandidate(el) {
    const direct = normText(el.textContent || "");
    if (direct && direct.length <= 40) return direct;
    const span = el.querySelector("span");
    if (span) {
      const s = normText(span.textContent || "");
      if (s && s.length <= 40) return s;
    }
    return null;
  }
  function buildTextXPathCandidates(text) {
    const exact = `//*[normalize-space(.)=${quoteXpath(text)}]`;
    const contains = `//*[contains(normalize-space(.),${quoteXpath(text)})]`;
    return { exact, contains };
  }
  function buildFromAnchorToTargetXPath(anchor, target) {
    if (anchor.contains(target)) {
      const t2 = getTag(target);
      const hit = getTestAttr(target);
      if (hit) return `.${xpathByAttr(t2, hit.attr, hit.value).replace(/^\/\//, "//")}`;
      const id = target.getAttribute("id");
      if (id) return `.//${t2}[@id=${quoteXpath(id)}]`;
      const name = target.getAttribute("name");
      if (name) return `.//${t2}[@name=${quoteXpath(name)}]`;
      return `.//${t2}[1]`;
    }
    const t = getTag(target);
    return `.//following::${t}[1]`;
  }
  function generateSelectors(target, mode, doc) {
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
      const combined = rel?.startsWith(".//") ? `${anchorXPath}${rel.substring(1)}` : `${anchorXPath}//${targetTag}[1]`;
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

  // src/content.ts
  console.log("[SelectorGen] content script loaded");
  window.__selectorGenLoaded = true;
  function isElement(n) {
    return !!n && typeof n === "object" && n.nodeType === 1;
  }
  var pickerActive = false;
  var lastRightClicked = null;
  function normalizeMode(mode) {
    return mode === "css" ? "css" : "xpath";
  }
  function installRightClickTracker() {
    if (window.__selectorGenRightClickTrackerInstalled) return;
    document.addEventListener(
      "contextmenu",
      (event) => {
        const target = event.target;
        lastRightClicked = isElement(target) ? target : null;
      },
      true
    );
    window.__selectorGenRightClickTrackerInstalled = true;
  }
  installRightClickTracker();
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "true");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  }
  function showToast(message) {
    const existing = document.getElementById("__selector_gen_toast");
    existing?.remove();
    const toast = document.createElement("div");
    toast.id = "__selector_gen_toast";
    toast.textContent = message;
    toast.style.position = "fixed";
    toast.style.right = "16px";
    toast.style.bottom = "16px";
    toast.style.zIndex = "2147483647";
    toast.style.maxWidth = "320px";
    toast.style.padding = "10px 12px";
    toast.style.borderRadius = "8px";
    toast.style.background = "rgba(17, 24, 39, 0.94)";
    toast.style.color = "#fff";
    toast.style.font = "13px/1.4 system-ui, sans-serif";
    toast.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.24)";
    document.documentElement.appendChild(toast);
    window.setTimeout(() => toast.remove(), 2200);
  }
  async function handleTarget(target, mode) {
    const result = generateSelectors(target, mode, document);
    await copyText(result.preferred);
    showToast(`Copied ${mode.toUpperCase()} selector`);
  }
  async function startPicker(mode) {
    installRightClickTracker();
    if (pickerActive) return;
    pickerActive = true;
    showToast(`Picker active: click an element to copy ${mode.toUpperCase()}`);
    const onClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.target;
      pickerActive = false;
      document.removeEventListener("click", onClick, true);
      if (!isElement(target)) {
        showToast("No element selected.");
        return;
      }
      void handleTarget(target, mode);
    };
    document.addEventListener("click", onClick, true);
  }
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "PING") {
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "START_PICKER") {
      void startPicker(normalizeMode(msg.mode));
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "GENERATE_FROM_LAST_RIGHT_CLICK") {
      installRightClickTracker();
      if (!lastRightClicked) {
        showToast("No right-click target yet. Right-click an element first.");
        sendResponse({ ok: false, reason: "no_target" });
        return;
      }
      void handleTarget(lastRightClicked, normalizeMode(msg.mode));
      sendResponse({ ok: true });
      return;
    }
  });
})();
//# sourceMappingURL=content.js.map
