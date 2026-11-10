// Which lane a task enters next. Conditions are data and the host evaluates them: there is no
// expression to run. Rounds are counted per transition entry, so two loops never share a limit.
import type { Condition, Lane, Transition } from "../schema/workflow.ts";
import type { Outcome } from "../store.ts";

export interface Facts {
  /** The id of the collector that found the task. */
  source: string;
  labels: string[];
  tier: string;
  outputs: Record<string, Record<string, unknown>>;
  gates: Record<string, Record<string, string>>;
}

export function valueAt(ref: string, facts: Facts): unknown {
  if (ref === "task.source") return facts.source;
  if (ref === "task.labels") return facts.labels;
  if (ref === "change.tier") return facts.tier;
  const [lane, kind, name] = ref.split(".");
  if (!lane || !name) return undefined;
  const from = kind === "gates" ? facts.gates[lane] : facts.outputs[lane];
  return from && Object.hasOwn(from, name) ? from[name] : undefined;
}

export function holds(when: Condition, facts: Facts): boolean {
  const value = valueAt(when.ref, facts);
  const list = when.in ?? when.notIn ?? [];
  const found = Array.isArray(value) ? value.some((v) => list.includes(v)) : list.includes(value as never);
  return when.in ? found : !found;
}

export interface Choice {
  to: string;
  /** The bounded entry that was taken, as `<lane>.<outcome>[<index>]`. The caller counts it. */
  key?: string;
  /** Bounded entries that applied but had no rounds left. */
  exhausted: string[];
}

export function choose(lane: Lane, outcome: Outcome, facts: Facts, rounds: Record<string, number>): Choice {
  const transition: Transition = lane.on[outcome] ?? "@inbox";
  if (typeof transition === "string") return { to: transition, exhausted: [] };
  const exhausted: string[] = [];
  for (const [i, step] of transition.entries()) {
    if (step.when && !holds(step.when, facts)) continue;
    if (step.maxRounds === undefined) return { to: step.to, exhausted };
    const key = `${lane.id}.${outcome}[${i}]`;
    if ((rounds[key] ?? 0) < step.maxRounds) return { to: step.to, key, exhausted };
    exhausted.push(key);
  }
  return { to: "@stop", exhausted }; // the checker requires a plain last entry, so this is not reached
}
