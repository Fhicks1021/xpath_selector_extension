"use strict";
(() => {
  // shared/mode.ts
  var STORAGE_KEY = "selector_output_mode";
  async function getMode() {
    const res = await chrome.storage.sync.get(STORAGE_KEY);
    return res[STORAGE_KEY] || "xpath";
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

  // src/background.ts
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: "copy-selector",
      title: "Copy selector (XPath/CSS)",
      contexts: ["all"]
    });
  });
  chrome.contextMenus.onClicked.addListener(async (_info, tab) => {
    const tabId = tab?.id;
    if (tabId == null || !tab) return;
    const mode = await getMode();
    try {
      await sendMessageWithContentScript(tab, { type: "GENERATE_FROM_LAST_RIGHT_CLICK", mode });
    } catch (err) {
      console.error("[SelectorGen] context menu failed", err);
    }
  });
})();
//# sourceMappingURL=background.js.map
