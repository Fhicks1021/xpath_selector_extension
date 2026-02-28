console.log("[SelectorGen] content script loaded");
(window as any).__selectorGenLoaded = true;

import type { OutputMode } from "../shared/mode";
import { generateSelectors } from "../shared/selector";

function isElement(n: unknown): n is Element {
  return !!n && typeof n === "object" && (n as Element).nodeType === 1;
}

let pickerActive = false;
let lastRightClicked: Element | null = null;

function normalizeMode(mode: unknown): OutputMode {
  return mode === "css" ? "css" : "xpath";
}

function installRightClickTracker(): void {
  if ((window as any).__selectorGenRightClickTrackerInstalled) return;

  document.addEventListener(
    "contextmenu",
    event => {
      const target = event.target;
      lastRightClicked = isElement(target) ? target : null;
    },
    true
  );

  (window as any).__selectorGenRightClickTrackerInstalled = true;
}

installRightClickTracker();

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
    document.execCommand("copy");
    ta.remove();
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

async function handleTarget(target: Element, mode: OutputMode): Promise<void> {
  const result = generateSelectors(target, mode, document);
  await copyText(result.preferred);
  showToast(`Copied ${mode.toUpperCase()} selector`);
}

async function startPicker(mode: OutputMode): Promise<void> {
  installRightClickTracker();
  if (pickerActive) return;
  pickerActive = true;

  showToast(`Picker active: click an element to copy ${mode.toUpperCase()}`);

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
export {};
