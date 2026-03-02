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
  const saveBtn = q<HTMLButtonElement>("#btn-save");
  const saveStatus = q<HTMLDivElement>("#save-status");
  const pickBtn = q<HTMLButtonElement>("#btn-pick");
  const xpathRow = q<HTMLLabelElement>("#row-xpath");
  const cssRow = q<HTMLLabelElement>("#row-css");

  let selectedMode: OutputMode = "xpath";
  let savedMode: OutputMode = "xpath";

  function setStatus(message: string, state: "success" | "error" | ""): void {
    saveStatus.textContent = message;
    if (state) {
      saveStatus.dataset.state = state;
      return;
    }

    delete saveStatus.dataset.state;
  }

  function applyMode(mode: OutputMode): void {
    selectedMode = mode;
    xpathRadio.checked = mode === "xpath";
    cssRadio.checked = mode === "css";
    if (selectedMode === savedMode) {
      setStatus(`Saved preference: ${savedMode.toUpperCase()}`, "success");
      return;
    }

    setStatus("", "");
  }

  const mode = await getMode();
  savedMode = mode;
  applyMode(mode);

  xpathRadio.addEventListener("change", () => {
    if (xpathRadio.checked) applyMode("xpath");
  });

  cssRadio.addEventListener("change", () => {
    if (cssRadio.checked) applyMode("css");
  });

  xpathRow.addEventListener("click", () => {
    applyMode("xpath");
  });

  cssRow.addEventListener("click", () => {
    applyMode("css");
  });

  saveBtn.addEventListener("click", async () => {
    try {
      saveBtn.disabled = true;
      setStatus("Saving preference...", "");
      await setMode(selectedMode);
      await chrome.runtime.sendMessage({ type: "REFRESH_CONTEXT_MENU" });
      savedMode = selectedMode;
      setStatus(`Saved preference: ${selectedMode.toUpperCase()}`, "success");
    } catch (error) {
      console.error("[SelectorGen] failed to save preference", error);
      setStatus("Unable to save preference.", "error");
    } finally {
      saveBtn.disabled = false;
    }
  });

  pickBtn.addEventListener("click", async () => {
    await injectAndSend({ type: "START_PICKER", mode: selectedMode });
    window.close();
  });
}

main().catch(console.error);
export {};
