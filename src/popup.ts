import { getMode, setMode, type OutputMode } from "../shared/mode";
import { getLastSelectorOptions, type StoredSelectorOptions } from "../shared/selection";
import type { RankedSelectorOption } from "../shared/selector";
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
  const results = q<HTMLDivElement>("#selector-results");
  const emptyResults = q<HTMLDivElement>("#selector-results-empty");
  const xpathRow = q<HTMLLabelElement>("#row-xpath");
  const cssRow = q<HTMLLabelElement>("#row-css");

  let selectedMode: OutputMode = "xpath";
  let savedMode: OutputMode = "xpath";
  const reportEmail = "xpath.selector.tool@gmail.com";

  function setStatus(message: string, state: "success" | "error" | ""): void {
    saveStatus.textContent = message;
    if (state) {
      saveStatus.dataset.state = state;
      return;
    }

    delete saveStatus.dataset.state;
  }

  async function copyText(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  }

  function getStrategyLabel(option: RankedSelectorOption): string {
    return option.debug.strategy.replace(/_/g, " ");
  }

  function buildReportHref(option: RankedSelectorOption, stored: StoredSelectorOptions): string {
    const subject = encodeURIComponent(`[Weak Selector] ${option.mode.toUpperCase()} ${option.debug.strategy}`);
    const body = encodeURIComponent([
      "A selector was reported as weak.",
      "",
      `Selector: ${option.selector}`,
      `Mode: ${option.mode}`,
      `Strategy: ${option.debug.strategy}`,
      `Target tag: ${option.debug.targetTag}`,
      `Captured at: ${new Date(stored.capturedAt).toISOString()}`,
      `Page URL: ${stored.pageUrl}`
    ].join("\n"));
    return `mailto:${reportEmail}?subject=${subject}&body=${body}`;
  }

  function renderSelectorCard(option: RankedSelectorOption, label: string, isPrimary: boolean, stored: StoredSelectorOptions): HTMLDivElement {
    const card = document.createElement("div");
    card.className = `selector-card${isPrimary ? " primary" : ""}`;

    const meta = document.createElement("div");
    meta.className = "selector-meta";

    const mode = document.createElement("span");
    mode.className = "selector-mode";
    mode.textContent = `${label} - ${option.mode.toUpperCase()}`;

    const strategy = document.createElement("span");
    strategy.textContent = getStrategyLabel(option);

    meta.append(mode, strategy);

    const text = document.createElement("p");
    text.className = "selector-text";
    text.textContent = option.selector;

    const button = document.createElement("button");
    button.className = "secondary-button selector-copy";
    button.textContent = "Copy to clipboard";
    button.addEventListener("click", async () => {
      try {
        button.disabled = true;
        await copyText(option.selector);
        setStatus(`Copied ${option.mode.toUpperCase()} selector`, "success");
      } catch (error) {
        console.error("[SelectorGen] failed to copy stored selector", error);
        setStatus("Unable to copy selector.", "error");
      } finally {
        button.disabled = false;
      }
    });

    const actions = document.createElement("div");
    actions.className = "selector-actions";

    const report = document.createElement("a");
    report.className = "selector-report";
    report.href = buildReportHref(option, stored);
    report.textContent = "Report weak selector";

    actions.append(button, report);
    card.append(meta, text, actions);
    return card;
  }

  function renderStoredSelectors(stored: StoredSelectorOptions | null): void {
    const cards = results.querySelectorAll(".selector-card");
    cards.forEach(card => card.remove());

    if (!stored?.primary) {
      emptyResults.hidden = false;
      return;
    }

    emptyResults.hidden = true;
    results.append(renderSelectorCard(stored.primary, "Primary", true, stored));
    stored.alternatives.slice(0, 3).forEach((option, index) => {
      results.append(renderSelectorCard(option, `Option ${index + 1}`, false, stored));
    });
  }

  function getActionErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("does not allow extension scripts")) {
      return "This page does not allow extension scripts. Try a normal website tab.";
    }

    if (message.includes("Content script did not respond")) {
      return "The page did not finish loading the picker. Try again once the page is fully loaded.";
    }

    if (message.includes("No active tab found")) {
      return "No active tab found.";
    }

    if (message.includes("Missing tab id")) {
      return "The current tab is unavailable. Try reloading the page.";
    }

    return "Unable to start the picker on this page.";
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
  renderStoredSelectors(await getLastSelectorOptions());

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
    try {
      pickBtn.disabled = true;
      setStatus("", "");
      await injectAndSend({ type: "START_PICKER", mode: selectedMode });
      window.close();
    } catch (error) {
      console.error("[SelectorGen] failed to start picker", error);
      setStatus(getActionErrorMessage(error), "error");
    } finally {
      pickBtn.disabled = false;
    }
  });
}

main().catch(console.error);
export {};
