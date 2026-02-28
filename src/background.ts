import { getMode, type OutputMode } from "../shared/mode";
import { sendMessageWithContentScript } from "../shared/runtime";

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
export {}; 
