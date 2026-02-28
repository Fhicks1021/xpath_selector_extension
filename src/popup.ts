import { getMode, setMode, type OutputMode } from "../shared/mode";
import { sendMessageWithContentScript } from "../shared/runtime";

function q<T extends HTMLElement>(sel: string): T {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el as T;
}

async function injectAndSend(msg: unknown): Promise<void> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab) throw new Error("No active tab found.");

  await sendMessageWithContentScript(tab, msg);
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
    const currentMode = await getMode();
    await injectAndSend({ type: "START_PICKER", mode: currentMode });
    window.close();
  });
}

main().catch(console.error);
export {};
