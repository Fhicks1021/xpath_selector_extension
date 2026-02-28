const RESTRICTED_PROTOCOL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "view-source:",
  "devtools://"
] as const;

function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  if (RESTRICTED_PROTOCOL_PREFIXES.some(prefix => url.startsWith(prefix))) return true;
  return url.startsWith("https://chromewebstore.google.com/");
}

type TabMessageResult<T> =
  | { delivered: true; response: T | undefined }
  | { delivered: false };

function sendMessageToTab<T>(tabId: number, message: unknown): Promise<TabMessageResult<T>> {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, message, response => {
      const err = chrome.runtime.lastError;
      if (err) {
        resolve({ delivered: false });
        return;
      }
      resolve({ delivered: true, response: response as T | undefined });
    });
  });
}

async function pingContentScript(tabId: number): Promise<boolean> {
  const result = await sendMessageToTab<{ ok?: boolean }>(tabId, { type: "PING" });
  return result.delivered && !!result.response?.ok;
}

export function assertInjectableTab(tab: chrome.tabs.Tab): void {
  const url = tab.url ?? tab.pendingUrl;
  if (!url || isRestrictedUrl(url)) {
    throw new Error("This page does not allow extension scripts. Try a normal website tab.");
  }
}

export async function ensureContentScript(tab: chrome.tabs.Tab): Promise<void> {
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
    await new Promise(r => setTimeout(r, 75));
  }

  throw new Error("Content script did not respond after injection.");
}

export async function sendMessageWithContentScript<T>(tab: chrome.tabs.Tab, message: unknown): Promise<T> {
  const tabId = tab.id;
  if (tabId == null) throw new Error("Missing tab id.");

  await ensureContentScript(tab);
  const result = await sendMessageToTab<T>(tabId, message);
  if (!result.delivered) {
    throw new Error("Content script was unavailable when sending the message.");
  }
  return result.response as T;
}
