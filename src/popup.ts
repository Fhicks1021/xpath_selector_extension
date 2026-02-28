type OutputMode = "xpath" | "css";

const STORAGE_KEY = "selector_output_mode";

function q<T extends HTMLElement>(sel: string): T {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el as T;
}

async function getMode(): Promise<OutputMode> {
  const res = await chrome.storage.sync.get(STORAGE_KEY);
  return (res[STORAGE_KEY] as OutputMode) || "xpath";
}

async function setMode(mode: OutputMode): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: mode });
}

async function injectAndSend(tabId: number, msg: unknown): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["dist/content.js"]
  });

  await chrome.tabs.sendMessage(tabId, msg);
}

async function getActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const t = tabs[0];
  return t?.id ?? null;
}

async function main(): Promise<void> {
  const xpathRadio = q<HTMLInputElement>("#out-xpath");
  const cssRadio = q<HTMLInputElement>("#out-css");
  const pickBtn = q<HTMLButtonElement>("#btn-pick");

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
    const tabId = await getActiveTabId();
    if (tabId == null) return;

    const currentMode = await getMode();
    await injectAndSend(tabId, { type: "START_PICKER", mode: currentMode });
    window.close();
  });
}

main().catch(console.error);