import type { ClassSelectorCandidate } from "./types";

export function quoteXpath(text: string): string {
  if (!text.includes("'")) return `'${text}'`;
  const parts = text.split("'").map(part => `'${part}'`);
  return `concat(${parts.join(", \"'\", ")})`;
}

export function buildAttrXPath(tag: string | "*", attr: string, value: string): string {
  return `//${tag}[@${attr}=${quoteXpath(value)}]`;
}

export function buildTaggedAttrXPath(tag: string, attr: string, value: string): string {
  return `//${tag}[@${attr}=${quoteXpath(value)}]`;
}

export function buildClassXPath(tag: string, classNames: string[]): string {
  const predicates = classNames.map(
    className => `contains(concat(' ', normalize-space(@class), ' '), ${quoteXpath(` ${className} `)})`
  );
  return `//${tag}[${predicates.join(" and ")}]`;
}

export function buildClassXPathCandidate(tag: string, classNames: string[], css: string): ClassSelectorCandidate {
  return {
    css,
    xpath: buildClassXPath(tag, classNames)
  };
}
