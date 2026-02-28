export type OutputMode = "xpath" | "css";

export const STORAGE_KEY = "selector_output_mode";

export async function getMode(): Promise<OutputMode> {
  const res = await chrome.storage.sync.get(STORAGE_KEY);
  return (res[STORAGE_KEY] as OutputMode) || "xpath";
}

export async function setMode(mode: OutputMode): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: mode });
}
