import { getMode, type OutputMode } from "../shared/mode";
import { sendMessageWithContentScript } from "../shared/runtime";

const MENU_ID = "selector-generator-copy";

function getMenuTitle(mode: OutputMode): string {
  return mode === "css" ? "Copy CSS selector" : "Copy XPath selector";
}

async function createContextMenus(mode: OutputMode): Promise<void> {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: MENU_ID,
    title: getMenuTitle(mode),
    contexts: ["all"]
  });
}

async function refreshContextMenu(): Promise<void> {
  const mode = await getMode();
  await createContextMenus(mode);
}

chrome.runtime.onInstalled.addListener(() => {
  void refreshContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  void refreshContextMenu();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !("selector_output_mode" in changes)) return;
  void refreshContextMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (String(info.menuItemId) !== MENU_ID || !tab) return;

  void (async () => {
    const mode = await getMode();
    const targetElementId = (info as chrome.contextMenus.OnClickData & { targetElementId?: number }).targetElementId;
    await sendMessageWithContentScript(tab, { type: "COPY_CONTEXT_TARGET", mode, targetElementId });
  })();
});
