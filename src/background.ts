import { getMode, STORAGE_KEY, type OutputMode } from "../shared/mode";
import { sendMessageWithContentScript } from "../shared/runtime";

const MENU_ID = "copy-selector";

function modeLabel(mode: OutputMode): string {
  return mode === "css" ? "CSS" : "XPath";
}

async function upsertContextMenu(): Promise<void> {
  const mode = await getMode();
  const title = `Copy ${modeLabel(mode)} selector`;

  try {
    await chrome.contextMenus.update(MENU_ID, { title, contexts: ["all"] });
  } catch {
    chrome.contextMenus.create({
      id: MENU_ID,
      title,
      contexts: ["all"]
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void upsertContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  void upsertContextMenu();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (!(STORAGE_KEY in changes)) return;
  void upsertContextMenu();
});

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;
  if ((msg as { type?: string }).type !== "REFRESH_CONTEXT_MENU") return;

  void upsertContextMenu().then(() => sendResponse({ ok: true }));
  return true;
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
export {}; 
