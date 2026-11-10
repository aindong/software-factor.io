// How a run's files are grouped for the viewer: pairs, recordings, images, text, the rest.
import { describe, expect, it } from "vitest";
import { groupEvidence, kindOf } from "../../src/core/runs/track.ts";

const f = (name: string, path = `.factor/runs/r1/evidence/${name}`) => ({ name, path });
const names = (list: { name: string }[]) => list.map((x) => x.name);

describe("the kind of a file", () => {
  it.each([
    ["shot.png", "image"],
    ["a.JPG", "image"],
    ["a.jpeg", "image"],
    ["a.gif", "image"],
    ["a.webp", "image"],
    ["run.webm", "recording"],
    ["run.mp4", "recording"],
    ["run.MOV", "recording"],
    ["01-build-verify.log", "text"],
    ["a.txt", "text"],
    ["a.md", "text"],
    ["a.json", "text"],
    ["a.jsonl", "text"],
    ["a.diff", "text"],
    ["a.html", "text"],
    ["a.svg", "text"],
    ["a.htm", "text"],
    ["a.xml", "text"],
    ["a.csv", "text"],
    ["a.yml", "text"],
    ["a.ts", "text"],
    ["a.zip", "other"],
    ["a.pdf", "other"],
    ["noextension", "other"],
    ["", "other"],
    [".png", "other"],
    ["a.png.exe", "other"],
  ])("%s is %s", (name, kind) => {
    expect(kindOf(name)).toBe(kind);
  });
});

describe("grouping a run's evidence", () => {
  it("pairs a before with the after of the same name", () => {
    const groups = groupEvidence([
      f("before.png"),
      f("after.png"),
      f("list-before.png"),
      f("list-after.png"),
      f("notes.txt"),
    ]);
    expect(groups.pairs.map((p) => [p.name, p.before.name, p.after.name])).toEqual([
      ["", "before.png", "after.png"],
      ["list", "list-before.png", "list-after.png"],
    ]);
    expect(names(groups.texts)).toEqual(["notes.txt"]);
    expect(groups.images).toEqual([]);
  });

  it.each([
    ["before-home.png", "after-home.png", "home"],
    ["home_before.png", "home_after.png", "home"],
    ["home.before.png", "home.after.png", "home"],
    ["Before.png", "After.png", ""],
    ["01-before-list.webp", "01-after-list.webp", "01 list"],
  ])("pairs %s with %s", (before, after, name) => {
    const { pairs, images } = groupEvidence([f(after), f(before)]);
    expect(pairs.map((p) => [p.name, p.before.name, p.after.name])).toEqual([[name, before, after]]);
    expect(images).toEqual([]);
  });

  it("does not pair what is not a pair", () => {
    const lone = groupEvidence([
      f("before.png"),
      f("after.jpg"),
      f("beforehand.png"),
      f("afterhand.png"),
      f("rafter.png"),
      f("before.txt"),
      f("after.txt"),
    ]);
    expect(lone.pairs).toEqual([]);
    expect(names(lone.images)).toEqual([
      "before.png",
      "after.jpg",
      "beforehand.png",
      "afterhand.png",
      "rafter.png",
    ]);
    expect(names(lone.texts)).toEqual(["before.txt", "after.txt"]);
  });

  it("uses each file once, also when two would fit", () => {
    const groups = groupEvidence([
      f("before.png", "p/1.png"),
      f("before.png", "p/2.png"),
      f("after.png", "p/3.png"),
    ]);
    expect(groups.pairs.length).toBe(1);
    expect(groups.pairs[0]?.before.path).toBe("p/1.png");
    expect(groups.images.map((i) => i.path)).toEqual(["p/2.png"]);
    const all = [
      ...groups.pairs.flatMap((p) => [p.before, p.after]),
      ...groups.images,
      ...groups.recordings,
      ...groups.texts,
      ...groups.others,
    ];
    expect(all.length).toBe(3);
  });

  it("sorts everything else into recordings, images, text and the rest, in the order given", () => {
    const groups = groupEvidence([f("b.webm"), f("z.png"), f("a.log"), f("a.zip"), f("a.mp4"), f("a.png")]);
    expect(names(groups.recordings)).toEqual(["b.webm", "a.mp4"]);
    expect(names(groups.images)).toEqual(["z.png", "a.png"]);
    expect(names(groups.texts)).toEqual(["a.log"]);
    expect(names(groups.others)).toEqual(["a.zip"]);
  });

  it("never pairs across two visits, and pairs each visit's own", () => {
    const at = (visit: number, name: string) => ({ name, path: `p/${visit}-${name}`, visit });
    const groups = groupEvidence([
      at(1, "before.png"),
      at(2, "after.png"),
      at(3, "before.png"),
      at(3, "after.png"),
      at(4, "before.png"),
      at(4, "after.png"),
    ]);
    expect(groups.pairs.map((p) => [p.before.path, p.after.path])).toEqual([
      ["p/3-before.png", "p/3-after.png"],
      ["p/4-before.png", "p/4-after.png"],
    ]);
    expect(groups.images.map((i) => i.path)).toEqual(["p/1-before.png", "p/2-after.png"]);
  });

  it("keeps two videos as recordings, and a drawing as text", () => {
    const groups = groupEvidence([
      f("before.webm"),
      f("after.webm"),
      f("before.svg"),
      f("after.svg"),
      f("page.html"),
    ]);
    expect(groups.pairs).toEqual([]);
    expect(names(groups.recordings)).toEqual(["before.webm", "after.webm"]);
    expect(names(groups.texts)).toEqual(["before.svg", "after.svg", "page.html"]);
  });

  it("puts every file in exactly one group", () => {
    const given = [
      "before.png",
      "after.png",
      "x-before.png",
      "a.webm",
      "b.log",
      "c.zip",
      "d",
      "after.gif",
      "before.gif",
      "x-after.jpg",
    ].map((n) => f(n));
    const g = groupEvidence(given);
    const out = [
      ...g.pairs.flatMap((p) => [p.before, p.after]),
      ...g.images,
      ...g.recordings,
      ...g.texts,
      ...g.others,
    ];
    expect(out.map((x) => x.path).sort()).toEqual(given.map((x) => x.path).sort());
  });

  it("holds with nothing", () => {
    expect(groupEvidence([])).toEqual({ pairs: [], recordings: [], images: [], texts: [], others: [] });
  });
});
