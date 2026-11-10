// The palette's contrast, computed from src/ui/tokens.css for both themes (WCAG 2: 4.5 to 1 for
// text, 3 to 1 for a shape or a line that carries meaning).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/ui/tokens.css", "utf8");
/** The custom properties of one rule, by name. */
function tokens(selector: string): Record<string, string> {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`tokens.css has no rule "${selector}"`);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  return Object.fromEntries(
    [...body.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]),
  );
}
const light = tokens(":root {");
const themes: Record<string, Record<string, string>> = {
  light,
  dark: { ...light, ...tokens(':root[data-theme="dark"]') },
};

/** Relative luminance of an `oklch(L% C H)` colour, through OKLab and linear sRGB. */
function luminance(colour: string): number {
  const m = /^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)$/.exec(colour);
  if (!m) throw new Error(`not an oklch colour this test reads: ${colour}`);
  const [L, C, h] = [Number(m[1]) / 100, Number(m[2]), (Number(m[3]) * Math.PI) / 180];
  const [a, b] = [C * Math.cos(h), C * Math.sin(h)];
  const [l, mm, s] = [
    (L + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (L - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (L - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ];
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const [r, g, bl] = [
    clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}
function contrast(theme: Record<string, string>, one: string, other: string): number {
  const [x, y] = [luminance(theme[one] ?? ""), luminance(theme[other] ?? "")];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// text, and the ground it is set on somewhere in src/ui/*.css
const TEXT: [string, string, string][] = [
  ["ink", "ground", "body text"],
  ["ink", "panel", "text in the inspector, a selected row, a block of output"],
  ["ink-soft", "ground", "secondary text, labels, placeholders, a line a diff took out"],
  ["ink-soft", "panel", "secondary text in the inspector and on a selected row"],
  ["rail-ink", "rail", "the rail's current section"],
  ["rail-ink", "rail-active", "the rail's current section on its ground"],
  ["rail-ink-soft", "rail", "the rail's other sections"],
  ["signal-ink", "signal", "Approve, the rail's count, a train that waits"],
  ["ground", "ink", "the primary button, a train's number"],
];
// what carries meaning as a shape or a line
const SHAPES: [string, string, string][] = [
  ["through", "ground", "the pass line, a passed stop"],
  ["return", "ground", "the fail line, a failed stop"],
  ["end", "ground", "a line that ends the run, a stop not reached"],
  ["edge", "ground", "the border of a field, a select, a quiet button"],
  ["edge", "panel", "the border of a control in the inspector"],
  ["ink", "ground", "the focus ring, a station's outline"],
  ["ground", "ink", "the focus ring on the pressed half of a switch"],
  ["rail-ink", "rail", "the focus ring on the rail"],
  ["ink", "panel", "the focus ring on a panel"],
  ["signal-ink", "signal", "the border that carries signal yellow"],
  ["ground", "through", "the mark inside a passed station"],
  ["ground", "return", "the mark inside a failed station"],
  ["through", "panel", "a passed mark on a selected row"],
  ["return", "panel", "a failed mark on a selected row"],
  ["end", "panel", "a stop not reached on a selected row"],
];

describe.each(Object.entries(themes))("the %s theme", (_name, theme) => {
  it.each(TEXT)("%s on %s reads as text (%s)", (text, ground) => {
    expect(contrast(theme, text, ground)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(SHAPES)("%s on %s reads as a shape (%s)", (shape, ground) => {
    expect(contrast(theme, shape, ground)).toBeGreaterThanOrEqual(3);
  });
});

it("reads the two themes it means to: the dark one differs, and the system's dark is the same as the chosen dark", () => {
  expect(themes.dark?.ground).not.toBe(themes.light?.ground);
  const system = css.slice(
    css.indexOf("@media (prefers-color-scheme: dark)"),
    css.indexOf(':root[data-theme="dark"]'),
  );
  for (const [name, value] of Object.entries(tokens(':root[data-theme="dark"]'))) {
    expect(system, name).toContain(`--${name}: ${value};`);
  }
});

it("computes what WCAG computes", () => {
  const bw = { white: "oklch(100% 0 0)", black: "oklch(0% 0 0)", grey: "oklch(59.99% 0 0)" };
  expect(contrast(bw, "white", "black")).toBeCloseTo(21, 1);
  // oklch(59.99% 0 0) is #808080, which on white is the well-known 3.95
  expect(contrast(bw, "grey", "white")).toBeCloseTo(3.95, 1);
});
