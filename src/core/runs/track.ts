// Where a run has been, lane by lane, as the strip map, the big map and the scrubber draw it;
// and how a run's files are grouped for the evidence viewer. Pure: the page and the tests share it.

export type StopState = "none" | "pass" | "fail" | "asked" | "here" | "stopped";
export interface Visit {
  lane: string;
  outcome: "pass" | "fail" | "needsPerson" | null;
  /** A person stopped the lane: its outcome is a failure in the record, but it did not fail. */
  stopped?: true;
}
export interface Track {
  lanes: { id: string; state: StopState; gone?: true }[];
  /** The lane the train is on. */
  here: string | undefined;
}
const STATE = { pass: "pass", fail: "fail", needsPerson: "asked" } as const;

/**
 * The run after its first `n` visits (all of them when `n` is left out). A lane shows the outcome
 * of its latest visit among those, or "here" while that visit has none. The train is on the lane
 * of visit `n`; at the last step it is on `at`, the lane the record says the run is at, which is
 * nothing for a run that is done. A lane the workflow no longer has comes once, at the end.
 */
export function trackOf(order: string[], visits: Visit[], n?: number, at?: string | null): Track {
  const total = visits.length;
  const step = stepOf(total, n);
  const here = step < total ? visits[step - 1]?.lane : (at ?? undefined);
  const latest = new Map<string, Visit>();
  for (const visit of visits.slice(0, step)) latest.set(visit.lane, visit);
  const gone = [...new Set([...visits.map((v) => v.lane), ...(here ? [here] : [])])].filter(
    (id) => !order.includes(id),
  );
  const stateOf = (id: string): StopState => {
    const visit = latest.get(id);
    if (!visit) return id === here ? "here" : "none";
    return visit.stopped ? "stopped" : visit.outcome ? STATE[visit.outcome] : "here";
  };
  return {
    lanes: [
      ...order.map((id) => ({ id, state: stateOf(id) })),
      ...gone.map((id) => ({ id, state: stateOf(id), gone: true as const })),
    ],
    here,
  };
}

/** `n` as a whole step of a run of `total` visits: all of them when it is left out or no number. */
export const stepOf = (total: number, n?: number) =>
  n === undefined || Number.isNaN(n) ? total : Math.max(0, Math.min(total, Math.floor(n)));

export interface Leg {
  key: string;
  from: string;
  to: string;
  outcome: "pass" | "fail" | "needsPerson";
}
/**
 * The lines of the map a run took in its first `n` visits: from each lane, by its outcome, to the
 * lane it entered next. With `end`, the end the run came to ("@done" for a run that is done), also
 * the line from the last lane, by its outcome, to that end, at the last step.
 */
export function routeOf(lines: Leg[], visits: Visit[], n?: number, end?: string): Set<string> {
  const step = stepOf(visits.length, n);
  const taken = new Set<string>();
  const from = (visit: Visit | undefined) =>
    lines.filter((l) => l.from === visit?.lane && l.outcome === visit.outcome);
  for (let i = 0; i + 1 < step; i++) {
    const line = from(visits[i]).find((l) => l.to === visits[i + 1]?.lane);
    if (line) taken.add(line.key);
  }
  const out = end && step === visits.length ? from(visits[step - 1]).find((l) => l.to === end) : undefined;
  if (out) taken.add(out.key);
  return taken;
}

/**
 * The line a working run is travelling: the one it took from its last lane to the lane that is
 * open now. Nothing at the first lane, or when the map has no such line.
 */
export function travelledOf(lines: Leg[], visits: Visit[]): string | undefined {
  const [from, to] = [visits.at(-2), visits.at(-1)];
  return lines.find((l) => l.from === from?.lane && l.outcome === from.outcome && l.to === to?.lane)?.key;
}

export type Kind = "image" | "recording" | "text" | "other";
const KINDS: Record<Exclude<Kind, "other">, string[]> = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "avif"],
  recording: ["webm", "mp4", "mov"],
  // html and svg are text: a file an agent attached is never shown as a page or run as one
  text: [
    ...["log", "txt", "md", "json", "jsonl", "diff", "patch", "html", "htm", "svg", "xml", "csv"],
    ...["yml", "yaml", "toml", "ts", "tsx", "js", "jsx", "css", "sh", "py"],
  ],
};
/** What the viewer does with a file, by its name. */
export function kindOf(name: string): Kind {
  const ext = /^.+\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  for (const kind of ["image", "recording", "text"] as const) if (KINDS[kind].includes(ext)) return kind;
  return "other";
}

export interface EvidenceFile {
  /** The name its claim gave it, or its file name. */
  name: string;
  path: string;
  /** The lane visit it belongs to. */
  visit?: number;
}
export interface Groups<F extends EvidenceFile> {
  pairs: { name: string; before: F; after: F }[];
  recordings: F[];
  images: F[];
  texts: F[];
  others: F[];
}

/**
 * Two images of one visit whose names differ only in the word "before" or "after" are a pair.
 * Every file lands in exactly one group, in the order given.
 */
export function groupEvidence<F extends EvidenceFile>(files: F[]): Groups<F> {
  const groups: Groups<F> = { pairs: [], recordings: [], images: [], texts: [], others: [] };
  const sides = new Map<string, { label: string; before: number[]; after: number[] }>();
  for (const [i, file] of files.entries()) {
    if (kindOf(file.name) !== "image") continue;
    const [, stem = "", ext = ""] = /^(.*)\.([^.]+)$/.exec(file.name) ?? [];
    const word = /(^|[^A-Za-z])(before|after)(?=[^A-Za-z]|$)/i.exec(stem);
    if (!word) continue;
    const rest = `${stem.slice(0, word.index)}${word[1]} ${stem.slice(word.index + word[0].length)}`;
    const label = rest.replace(/[-_.\s]+/g, " ").trim();
    const key = `${file.visit ?? ""}|${ext.toLowerCase()}|${label.toLowerCase()}`;
    const side = sides.get(key) ?? { label, before: [], after: [] };
    side[word[2]?.toLowerCase() === "before" ? "before" : "after"].push(i);
    sides.set(key, side);
  }
  const pairs: { first: number; name: string; before: F; after: F }[] = [];
  const used = new Set<number>();
  for (const side of sides.values()) {
    for (const [k, b] of side.before.entries()) {
      const a = side.after[k];
      if (a === undefined) break;
      for (const i of [a, b]) used.add(i);
      pairs.push({ first: Math.min(a, b), name: side.label, before: files[b] as F, after: files[a] as F });
    }
  }
  // pairs in the order their first file was given
  groups.pairs = pairs.sort((p, q) => p.first - q.first).map(({ first, ...pair }) => pair);
  const lists = {
    image: groups.images,
    recording: groups.recordings,
    text: groups.texts,
    other: groups.others,
  };
  for (const [i, file] of files.entries()) if (!used.has(i)) lists[kindOf(file.name)].push(file);
  return groups;
}
