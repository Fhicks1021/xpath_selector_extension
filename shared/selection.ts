import type { RankedSelectorOption } from "./selector/types";

export const LAST_SELECTOR_OPTIONS_KEY = "last_selector_options";

export type StoredSelectorOptions = {
  primary: RankedSelectorOption | null;
  alternatives: RankedSelectorOption[];
  capturedAt: number;
  pageUrl: string;
};

export async function getLastSelectorOptions(): Promise<StoredSelectorOptions | null> {
  const res = await chrome.storage.local.get(LAST_SELECTOR_OPTIONS_KEY);
  return (res[LAST_SELECTOR_OPTIONS_KEY] as StoredSelectorOptions | null) ?? null;
}

export async function setLastSelectorOptions(value: StoredSelectorOptions): Promise<void> {
  await chrome.storage.local.set({ [LAST_SELECTOR_OPTIONS_KEY]: value });
}
