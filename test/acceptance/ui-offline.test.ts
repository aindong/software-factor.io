import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureUi } from "../helpers/repo.ts";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

describe("the built interface, with no network", () => {
  beforeAll(() => ensureUi(), 120_000);

  it("carries its fonts in the package", () => {
    const fonts = files("dist/ui").filter((f) => f.endsWith(".woff2"));
    expect(fonts.some((f) => /barlow-semi-condensed/i.test(f))).toBe(true);
    expect(fonts.some((f) => /barlow-(latin|\d)/i.test(f) && !/semi-condensed/i.test(f))).toBe(true);
  });

  it("names no address outside this machine to load anything from", () => {
    for (const file of files("dist/ui").filter((f) => /\.(html|css)$/.test(f))) {
      const text = readFileSync(file, "utf8");
      const loaded =
        text.match(
          /(?:src|href)="https?:\/\/[^"]+"|url\(\s*["']?https?:\/\/[^)]+\)|@import\s+["']https?:/g,
        ) ?? [];
      expect(loaded, file).toEqual([]);
    }
  });

  it("is one page with its script and its styles beside it", () => {
    const page = readFileSync("dist/ui/index.html", "utf8");
    expect(page).toMatch(/<script type="module"[^>]+src="\/assets\//);
    expect(page).toMatch(/<link rel="stylesheet"[^>]+href="\/assets\//);
    expect(page).toContain('name="factor-token"');
  });
});
