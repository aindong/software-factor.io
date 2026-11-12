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
    expect(fonts.some((f) => /jetbrains-mono/i.test(f))).toBe(true);
    expect(fonts.some((f) => /inter-.*opsz/i.test(f))).toBe(true);
  });

  it("names no address outside this machine to load anything from", () => {
    for (const file of files("dist/ui").filter((f) => /\.(html|css)$/.test(f))) {
      const text = readFileSync(file, "utf8");
      const loaded =
        text.match(
          /(?:src|href)=["'](?:https?:)?\/\/[^"']+["']|url\(\s*["']?(?:https?:)?\/\/[^)]+\)|@import\s+["'](?:https?:)?\/\//g,
        ) ?? [];
      expect(loaded, file).toEqual([]);
    }
  });

  it("has no address in its script but the names of standards and of the format itself", () => {
    // namespaces and schema names are identifiers, not places the page goes to, and React's error
    // text names its own documentation: none of them is fetched
    const known =
      /^https?:\/\/(www\.w3\.org\/|json-schema\.org\/|softwarefactor\.io\/schema\/|react\.dev\/errors\/)/;
    for (const file of files("dist/ui").filter((f) => f.endsWith(".js"))) {
      const found = readFileSync(file, "utf8").match(/https?:\/\/[A-Za-z0-9][A-Za-z0-9./_-]+/g) ?? [];
      expect(
        found.filter((address) => !known.test(address)),
        file,
      ).toEqual([]);
      expect(readFileSync(file, "utf8")).not.toMatch(/\bfetch\(\s*["'`]https?:/);
    }
  });

  it("is one page with its script and its styles beside it", () => {
    const page = readFileSync("dist/ui/index.html", "utf8");
    expect(page).toMatch(/<script type="module"[^>]+src="\/assets\//);
    expect(page).toMatch(/<link rel="stylesheet"[^>]+href="\/assets\//);
    expect(page).not.toContain("factor-token"); // the page is the same for everyone: it holds no key
  });
});
