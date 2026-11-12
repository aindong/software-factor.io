// DESIGN.md is the record of what shipped: it names the values the code uses, and the code keeps
// the rules it states (one meaning per colour, no colour outside the palette, state steps).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureUi } from "../helpers/repo.ts";

const design = readFileSync("DESIGN.md", "utf8");
const tokensCss = readFileSync("src/ui/tokens.css", "utf8");
const sheets = readdirSync("src/ui")
  .filter((f) => f.endsWith(".css") && f !== "tokens.css")
  .map((f) => ({ file: f, css: readFileSync(join("src/ui", f), "utf8") }));
const block = (selector: string) => {
  const at = tokensCss.indexOf(selector);
  const body = tokensCss.slice(tokensCss.indexOf("{", at) + 1, tokensCss.indexOf("}", at));
  return [...body.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map(
    (m) => [m[1] ?? "", (m[2] ?? "").trim()] as const,
  );
};
/** A line of DESIGN.md that names the token and holds the value. */
const recorded = (name: string, value: string) =>
  design.split("\n").some((line) => line.includes(`--${name}`) && line.includes(value));

describe("DESIGN.md records what shipped", () => {
  it.each(block(":root {").filter(([name]) => name !== "shadow"))(
    "the light value of --%s",
    (name, value) => {
      expect(recorded(name, value), `no line of DESIGN.md names --${name} with ${value}`).toBe(true);
    },
  );
  it.each(block(':root[data-theme="dark"]').filter(([name]) => name !== "shadow"))(
    "the dark value of --%s",
    (name, value) => {
      expect(recorded(name, value), `no line of DESIGN.md names --${name} with ${value}`).toBe(true);
    },
  );

  it("names every radius the styles use", () => {
    const used = new Set(
      sheets.flatMap(({ css }) =>
        [...css.matchAll(/border(?:-[a-z]+)*-radius:\s*([^;]+);/g)].flatMap((m) => (m[1] ?? "").split(/\s+/)),
      ),
    );
    for (const radius of [...used].filter((r) => /^\d/.test(r) && r !== "0")) {
      expect(design, `a radius of ${radius} is used and not recorded`).toMatch(
        new RegExp(`(^|[^\\d.])${radius.replace(".", "\\.")}([^\\d]|$)`, "m"),
      );
    }
  });

  it("names the fonts the build bundles", () => {
    ensureUi();
    const built = readdirSync("dist/ui/assets").join(" ");
    expect(built).toMatch(/inter-latin-opsz-normal.*\.woff2/);
    expect(built).toMatch(/jetbrains-mono-latin-wght-normal.*\.woff2/);
    expect(design).toContain("JetBrains Mono");
    expect(design).toContain("Inter Variable");
    expect(tokensCss).toMatch(/--font: "Inter Variable"/);
  });

  it("has a part for each screen that exists, and is no longer a direction written before any screen", () => {
    for (const screen of ["Floor", "Runs", "Inbox", "Accounts", "Costs", "Plugins"]) {
      expect(design, screen).toMatch(new RegExp(`^#{2,4} .*${screen}`, "m"));
    }
    expect(design).not.toMatch(/before any screen exists|starting values/);
  });
});

describe("the styles keep the rules DESIGN.md states", () => {
  it("no colour is written outside the palette", () => {
    for (const { file, css } of sheets) {
      const literal = css.match(/oklch\(|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) ?? [];
      expect(literal, file).toEqual([]);
    }
  });

  it("state steps: nothing fades or slides, and only work in progress moves, and not under reduced motion", () => {
    // a block of a style sheet, from its opening line to the brace that closes it
    const blocks = (css: string, opening: RegExp) => {
      const found: string[] = [];
      for (const m of css.matchAll(new RegExp(opening, "g"))) {
        let depth = 0;
        for (let i = (m.index ?? 0) + m[0].length - 1; i < css.length; i++) {
          depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
          if (depth === 0) {
            found.push(css.slice(m.index, i + 1));
            break;
          }
        }
      }
      return found;
    };
    const moving = /@media \(prefers-reduced-motion: no-preference\)\s*\{/;
    for (const { file, css } of sheets) {
      expect(css, file).not.toMatch(/\btransition\b/);
      // every animation is inside the no-preference block, so reduced motion leaves the still marks
      let rest = css;
      for (const b of blocks(css, moving)) rest = rest.replace(b, "");
      expect(rest, file).not.toMatch(/\banimation\b|@keyframes/);
    }
    // and each one is named for the one meaning: work is going on
    const named = sheets.flatMap(({ css }) =>
      blocks(css, moving).flatMap((b) =>
        [...b.matchAll(/animation(?:-name)?:\s*([a-z-]+)/g)].map((m) => m[1]),
      ),
    );
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) expect(name, "an animation").toMatch(/^at-work-/);
    expect(design).toMatch(/work is going on right now/);
  });

  it("signal yellow is only where a person can act", () => {
    // a rule of the styles that uses the colour, by its selector
    const may = [
      /\.button\.approve/, // the decision buttons
      /\.rail \.count/, // how many wait
      /\.mark\.asked/, // a row or a lane that waits for a person
      /\.strip \.stop\.asked/,
      /\.map \.train\.asks/, // a run that waits, on the map
      /\.map \.line\.needsPerson/, // the route that asks a person
      /\.map \.station\.end\.inbox/,
      /\.map \.station\.ran-asked/,
      /\.legend \.asks/,
      /\.inspector \.route\.needsPerson/,
    ];
    for (const { file, css } of sheets) {
      for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/var\(--signal\)/.test(rule[2] ?? "")) continue;
        const selector = (rule[1] ?? "").trim();
        expect(
          may.some((ok) => ok.test(selector)),
          `${file}: ${selector}`,
        ).toBe(true);
      }
    }
  });
});
