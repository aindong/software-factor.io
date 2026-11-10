// The edits the factory floor makes to a workflow: place a lane, take one out, rename one, connect
// an outcome, change a setting. Each takes a workflow as plain JSON and returns a new one. None
// changes the one it was given, and none checks the result: the checker does that, on every edit.
// The interface uses them now, and the command line and the MCP server can use the same ones.

type Json = Record<string, unknown>;
type LaneJson = Json & { id: string; on: Record<string, unknown> };
type Step = { to: string; when?: unknown; maxRounds?: number };

export const END_TARGETS = ["@done", "@inbox", "@stop", "@drop"];
const ID = /^[a-z][a-z0-9-]*$/;
const lanesOf = (w: Json): LaneJson[] =>
  Array.isArray(w.lanes) ? (w.lanes.filter((l) => typeof l === "object" && l !== null) as LaneJson[]) : [];
const stepsOf = (transition: unknown): Step[] =>
  typeof transition === "string"
    ? [{ to: transition }]
    : Array.isArray(transition)
      ? (transition as Step[])
      : [];
/** A transition with every step that leads to `from` leading to `to` instead. */
const retarget = (transition: unknown, from: string, to: string): unknown =>
  typeof transition === "string"
    ? transition === from
      ? to
      : transition
    : Array.isArray(transition)
      ? (transition as Step[]).map((s) => (s.to === from ? { ...s, to } : s))
      : transition;
const withLanes = (w: Json, lanes: LaneJson[]): Json => ({ ...w, lanes });
const mapOn = (lane: LaneJson, change: (transition: unknown) => unknown): LaneJson => ({
  ...lane,
  on: Object.fromEntries(Object.entries(lane.on ?? {}).map(([outcome, t]) => [outcome, change(t)])),
});

/**
 * Place a new lane on the line, after the lane named or at the end: the lane before it now passes
 * to it, and it passes on to where that lane passed before.
 */
export function addLane(w: Json, at: { after?: string; kind: "agent" | "command" | "wait" }): Json {
  const lanes = lanesOf(w);
  const taken = new Set(lanes.map((l) => l.id));
  let id = "lane";
  for (let n = 2; taken.has(id); n++) id = `lane-${n}`;
  const index = at.after === undefined ? lanes.length - 1 : lanes.findIndex((l) => l.id === at.after);
  const before = lanes[index < 0 ? lanes.length - 1 : index];
  // the default of the lane before: its pass target, or the last entry of its pass list
  const onward = stepsOf(before?.on?.pass).at(-1)?.to ?? "@done";
  const role = Object.keys((w.roles as Json | undefined) ?? {})[0] ?? "author";
  const on = { pass: onward, fail: "@stop" };
  const lane: LaneJson =
    at.kind === "agent"
      ? {
          id,
          uses: "core/agent@1",
          agent: { role, access: "read", prompt: "Say what this lane must do, and what it hands off." },
          checkpoint: "in", // a new lane starts with a person in the loop
          on,
        }
      : at.kind === "command"
        ? { id, uses: "core/command@1", with: {}, checkpoint: "in", on }
        : { id, uses: "core/wait@1", with: { minutes: 5 }, checkpoint: "out", on };
  if (!before) return withLanes(w, [lane]);
  const steps = stepsOf(before.on?.pass);
  const pass = steps.length <= 1 ? id : steps.map((s, i) => (i === steps.length - 1 ? { ...s, to: id } : s));
  const place = lanes.indexOf(before);
  return withLanes(w, [
    ...lanes.slice(0, place),
    { ...before, on: { ...before.on, pass } },
    lane,
    ...lanes.slice(place + 1),
  ]);
}

/** Take a lane out. Lines that led to it lead on to where it passed to. The last lane stays. */
export function removeLane(w: Json, id: string): Json {
  const lanes = lanesOf(w);
  const gone = lanes.find((l) => l.id === id);
  if (!gone || lanes.length <= 1) return w;
  const onward = stepsOf(gone.on?.pass).at(-1)?.to;
  const to = onward === undefined || onward === id ? "@stop" : onward;
  return withLanes(
    w,
    lanes.filter((l) => l !== gone).map((lane) => mapOn(lane, (t) => retarget(t, id, to))),
  );
}

/** Give a lane another id, and keep every name that pointed at it right. */
export function renameLane(w: Json, id: string, to: string): Json {
  const lanes = lanesOf(w);
  if (!ID.test(to) || to === id || lanes.some((l) => l.id === to) || !lanes.some((l) => l.id === id))
    return w;
  // a lane is named as a target, as the session to continue, and at the start of a value's name
  const starts = [`${id}.outputs.`, `${id}.gates.`];
  const walk = (value: unknown, key = ""): unknown => {
    if (typeof value === "string") {
      if ((key === "to" || key === "continue") && value === id) return to;
      return starts.some((start) => value.startsWith(start)) ? to + value.slice(id.length) : value;
    }
    if (Array.isArray(value)) return value.map((v) => walk(v, key));
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
    }
    return value;
  };
  return withLanes(
    w,
    lanes.map((lane) => {
      const renamed = mapOn(walk(lane) as LaneJson, (t) => retarget(t, id, to));
      return lane.id === id ? { ...renamed, id: to } : renamed;
    }),
  );
}

/**
 * Point an outcome of a lane at a lane or an end. A connection that leads back, to an earlier lane
 * or to the lane itself, gets a round limit and a way out, as the format requires. Any conditions
 * the outcome had are replaced: those are written in the JSON view.
 */
export function connect(w: Json, from: string, outcome: "pass" | "fail" | "needsPerson", to: string): Json {
  const lanes = lanesOf(w);
  const [a, b] = [lanes.findIndex((l) => l.id === from), lanes.findIndex((l) => l.id === to)];
  if (a < 0 || (b < 0 && !END_TARGETS.includes(to))) return w;
  const back = b >= 0 && b <= a;
  const transition = back ? [{ to, maxRounds: 2 }, { to: "@stop" }] : to;
  return withLanes(
    w,
    lanes.map((lane, i) => (i === a ? { ...lane, on: { ...lane.on, [outcome]: transition } } : lane)),
  );
}

/** Set fields of a lane. A field set to undefined is removed. `agent` is merged, not replaced. */
export function updateLane(w: Json, id: string, patch: Json): Json {
  const merge = (base: Json, change: Json): Json =>
    Object.fromEntries(Object.entries({ ...base, ...change }).filter(([, v]) => v !== undefined));
  return withLanes(
    w,
    lanesOf(w).map((lane) => {
      if (lane.id !== id) return lane;
      const { agent, ...rest } = patch;
      const merged = merge(lane, rest) as LaneJson;
      return agent === undefined || typeof agent !== "object" || agent === null
        ? merged
        : { ...merged, agent: merge((lane.agent as Json | undefined) ?? {}, agent as Json) };
    }),
  );
}
