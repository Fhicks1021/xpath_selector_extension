import type { OutputMode } from "../shared/mode";
import { setLastSelectorOptions } from "../shared/selection";
import { generateRankedSelectorOptions } from "../shared/selector";

function isElement(n: unknown): n is Element {
  return !!n && typeof n === "object" && (n as Element).nodeType === 1;
}

let pickerActive = false;
let lastContextTarget: Element | null = null;

function normalizeMode(mode: unknown): OutputMode {
  return mode === "css" ? "css" : "xpath";
}

async function copyText(text: string): Promise<void> {
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
    const copied = document.execCommand("copy");
    ta.remove();
    if (!copied) {
      throw new Error("Clipboard copy command failed.");
    }
  }
}

function showToast(message: string): void {
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

function countSelectorMatches(selector: string, mode: OutputMode, doc: Document): number {
  if (mode === "css") {
    try {
      return doc.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  }

  try {
    const result = doc.evaluate(selector, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    return result.snapshotLength;
  } catch {
    return 0;
  }
}

async function handleTarget(target: Element, mode: OutputMode): Promise<void> {
  try {
    const ranked = generateRankedSelectorOptions(target, mode, document, 4);
    const [primary, ...alternatives] = ranked;

    if (!primary) {
      const message = "Unable to find a unique identifier. Please manually construct your selector.";
      await copyText(message);
      await setLastSelectorOptions({ primary: null, alternatives: [], capturedAt: Date.now(), pageUrl: location.href });
      showToast("Copied warning: unable to find a unique identifier");
      return;
    }

    const matchCount = countSelectorMatches(primary.selector, primary.mode, document);

    if (matchCount !== 1) {
      const message = [
        `${primary.mode.toUpperCase()} selector is not unique.`,
        `Matched: ${matchCount} elements`,
        `Selector: ${primary.selector}`
      ].join("\n");
      await copyText(message);
      await setLastSelectorOptions({ primary, alternatives, capturedAt: Date.now(), pageUrl: location.href });
      showToast(`Copied warning: selector matched ${matchCount} elements`);
      return;
    }

    await copyText(primary.selector);
    await setLastSelectorOptions({ primary, alternatives, capturedAt: Date.now(), pageUrl: location.href });
    showToast(`Copied ${primary.mode.toUpperCase()} selector`);
  } catch (error) {
    console.error("[SelectorGen] failed to copy selector", error);
    showToast("Unable to copy to clipboard");
  }
}

async function startPicker(mode: OutputMode): Promise<void> {
  showToast(`Picker active: click an element to copy ${mode.toUpperCase()}`);
  await startPickerWithMessage(mode);
}

async function startPickerWithMessage(mode: OutputMode, message?: string): Promise<void> {
  if (pickerActive) return;
  pickerActive = true;

  showToast(message ?? `Picker active: click an element to copy ${mode.toUpperCase()}`);

  const onClick = (event: MouseEvent) => {
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

document.addEventListener("contextmenu", event => {
  lastContextTarget = isElement(event.target) ? event.target : null;
}, true);

function getTargetFromContextMenuMessage(targetElementId: unknown): Element | null {
  if (typeof targetElementId === "number") {
    const browserContextMenus = (globalThis as typeof globalThis & {
      browser?: {
        contextMenus?: {
          getTargetElement?: (targetElementId: number) => Element | null;
        };
      };
    }).browser?.contextMenus;
    const targetFromBrowser = browserContextMenus?.getTargetElement?.(targetElementId);
    if (targetFromBrowser) return targetFromBrowser;

    const contextMenusApi = chrome.contextMenus as typeof chrome.contextMenus & {
      getTargetElement?: (targetElementId: number) => Element | null;
    };
    const target = contextMenusApi.getTargetElement?.(targetElementId);
    if (target) return target;
  }

  return lastContextTarget;
}

chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
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

  if (msg.type === "COPY_CONTEXT_TARGET") {
    const mode = normalizeMode(msg.mode);
    const target = getTargetFromContextMenuMessage(msg.targetElementId);
    if (!target) {
      void startPickerWithMessage(mode, `Context target unavailable after refresh. Click an element to copy ${mode.toUpperCase()}.`);
      sendResponse({ ok: true, fallback: "picker" });
      return;
    }

    void handleTarget(target, mode);
    sendResponse({ ok: true });
    return;
  }
});
export {};
