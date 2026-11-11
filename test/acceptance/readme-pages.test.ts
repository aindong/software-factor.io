// The README as a front page: its demo and screenshot are files that are there, each translation
// keeps the commands, the sections and the honest list of the English page, and every page links
// to the others.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

const ENGLISH = "README.md";
const TRANSLATED = ["zh-CN", "ja", "es"].map((lang) => `docs/i18n/README.${lang}.md`);
const PAGES = [ENGLISH, ...TRANSLATED];
const read = (page: string) => (existsSync(page) ? readFileSync(page, "utf8") : "");

/** Every local file a page points at (markdown links and images, HTML src and srcset), as a path from the root. */
function targets(page: string): string[] {
  const text = read(page);
  const found = [
    ...[...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1] ?? ""),
    ...[...text.matchAll(/\b(?:src|srcset|href)="([^"]+)"/g)].map((m) => m[1] ?? ""),
  ];
  return found
    .filter((to) => !/^(https?:|#|mailto:)/.test(to))
    .map((to) => normalize(join(dirname(page), to.replace(/#.*$/, ""))));
}
const blocks = (text: string) => [...text.matchAll(/^```[a-z]*\n[\s\S]*?^```$/gm)].map((m) => m[0]);
const headings = (text: string) => text.match(/^## /gm)?.length ?? 0;
/** The list items of the section on real agents: found by its English heading, and by that same place in a translation. */
function honest(text: string): number {
  const at = read(ENGLISH)
    .split(/^## /m)
    .findIndex((part) => part.startsWith("What has run with real agents"));
  return (text.split(/^## /m)[at] ?? "").match(/^- /gm)?.length ?? 0;
}

it("opens with the demo in both themes and shows the real interface", () => {
  const text = read(ENGLISH);
  const picture = /<picture>[\s\S]*?<\/picture>/.exec(text)?.[0] ?? "";
  expect(text.indexOf("<picture>")).toBeLessThan(text.indexOf("## "));
  expect(picture).toMatch(/<source media="\(prefers-color-scheme: dark\)" srcset="docs\/media\/[^"]+"/);
  expect(picture).toMatch(/<img src="docs\/media\/[^"]+"[^>]* alt="[^"]{20,}"/);
  expect(targets(ENGLISH)).toContain("docs/media/floor.png");
});

describe.each(PAGES)("%s", (page) => {
  it("points only at files that are there, and at the other three pages", () => {
    const all = targets(page);
    expect(all.length).toBeGreaterThan(10);
    for (const path of all) expect(existsSync(path), path).toBe(true);
    for (const other of PAGES.filter((p) => p !== page)) expect(all, other).toContain(other);
  });

  it("holds no path of one machine", () => {
    expect(read(page)).not.toMatch(/\/Volumes\/|\/Users\/|\/home\/[a-z]/);
  });
});

describe.each(TRANSLATED)("%s", (page) => {
  it("keeps the commands, the sections, the honest list and the links of the English page", () => {
    const english = read(ENGLISH);
    const text = read(page);
    expect(blocks(text)).toEqual(blocks(english));
    expect(blocks(text).length).toBeGreaterThan(3);
    expect(headings(text)).toBe(headings(english));
    expect(honest(english)).toBeGreaterThan(10);
    expect(honest(text)).toBe(honest(english));
    const others = (p: string) => new Set(targets(p).filter((t) => !PAGES.includes(t)));
    expect([...others(page)].sort()).toEqual([...others(ENGLISH)].sort());
  });
});

it("can film the demo again with one command, and says how", () => {
  const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
  const file = /(\S+\.(?:sh|mjs|ts))/.exec(scripts["demo:film"] ?? "")?.[1] ?? "missing";
  expect(existsSync(file), file).toBe(true);
  expect(read("docs/demo.md")).toContain("demo:film");
  expect(targets(ENGLISH)).toContain("docs/demo.md");
});
