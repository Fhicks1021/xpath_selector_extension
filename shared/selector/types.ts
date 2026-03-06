export type OutputMode = "xpath" | "css";

export type SelectorResult = {
  preferred: string;
  alternate: string | null;
  debug: {
    strategy: string;
    anchor?: string;
    targetTag: string;
  };
};

export type RankedSelectorOption = {
  selector: string;
  mode: OutputMode;
  priority: number;
  debug: {
    strategy: string;
    anchor?: string;
    targetTag: string;
  };
};

export type StableAttr = {
  attr: string;
  value: string;
  kind: "test" | "data" | "generic";
};

export type SelectorCandidate = {
  css: string;
  xpath: string;
  strategy: string;
  anchor: string;
};

export type ClassSelectorCandidate = {
  css: string;
  xpath: string;
};
