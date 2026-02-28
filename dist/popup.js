"use strict";
(() => {
  // shared/mode.ts
  var STORAGE_KEY = "selector_output_mode";
  async function getMode() {
    const res = await chrome.storage.sync.get(STORAGE_KEY);
    return res[STORAGE_KEY] || "xpath";
  }
  async function setMode(mode) {
    await chrome.storage.sync.set({ [STORAGE_KEY]: mode });
  }

  // shared/runtime.ts
  var RESTRICTED_PROTOCOL_PREFIXES = [
    "chrome://",
    "chrome-extension://",
    "edge://",
    "about:",
    "view-source:",
    "devtools://"
  ];
  function isRestrictedUrl(url) {
    if (!url) return true;
    if (RESTRICTED_PROTOCOL_PREFIXES.some((prefix) => url.startsWith(prefix))) return true;
    return url.startsWith("https://chromewebstore.google.com/");
  }
  function sendMessageToTab(tabId, message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          resolve({ delivered: false });
          return;
        }
        resolve({ delivered: true, response });
      });
    });
  }
  async function pingContentScript(tabId) {
    const result = await sendMessageToTab(tabId, { type: "PING" });
    return result.delivered && !!result.response?.ok;
  }
  function assertInjectableTab(tab) {
    const url = tab.url ?? tab.pendingUrl;
    if (!url || isRestrictedUrl(url)) {
      throw new Error("This page does not allow extension scripts. Try a normal website tab.");
    }
  }
  async function ensureContentScript(tab) {
    const tabId = tab.id;
    if (tabId == null) throw new Error("Missing tab id.");
    assertInjectableTab(tab);
    if (await pingContentScript(tabId)) return;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["dist/content.js"]
    });
    for (let i = 0; i < 5; i++) {
      if (await pingContentScript(tabId)) return;
      await new Promise((r) => setTimeout(r, 75));
    }
    throw new Error("Content script did not respond after injection.");
  }
  async function sendMessageWithContentScript(tab, message) {
    const tabId = tab.id;
    if (tabId == null) throw new Error("Missing tab id.");
    await ensureContentScript(tab);
    const result = await sendMessageToTab(tabId, message);
    if (!result.delivered) {
      throw new Error("Content script was unavailable when sending the message.");
    }
    return result.response;
  }

  // src/popup.ts
  function q(sel) {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Missing element: ${sel}`);
    return el;
  }
  async function injectAndSend(msg) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab) throw new Error("No active tab found.");
    await sendMessageWithContentScript(tab, msg);
  }
  async function main() {
    const xpathRadio = q("#out-xpath");
    const cssRadio = q("#out-css");
    const pickBtn = q("#btn-pick");
    const mode = await getMode();
    xpathRadio.checked = mode === "xpath";
    cssRadio.checked = mode === "css";
    xpathRadio.addEventListener("change", async () => {
      if (xpathRadio.checked) await setMode("xpath");
    });
    cssRadio.addEventListener("change", async () => {
      if (cssRadio.checked) await setMode("css");
    });
    pickBtn.addEventListener("click", async () => {
      const currentMode = await getMode();
      await injectAndSend({ type: "START_PICKER", mode: currentMode });
      window.close();
    });
  }
  main().catch(console.error);
})();
//# sourceMappingURL=popup.js.map
