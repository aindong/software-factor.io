// Rules about how a task moves between lanes: targets exist, loops are bounded, conditions
// compare against values that can occur, every lane is reachable and some path finishes.
import type { Problem } from "./check.ts";
import {
  CHANGE_TIERS,
  type Condition,
  END_TARGETS,
  type Lane,
  type Transition,
  type Workflow,
} from "./workflow.ts";

type Add = (path: string, message: string, fix: string) => void;
type Step = { to: string; when?: Condition; maxRounds?: number };

const isEnd = (t: string) => (END_TARGETS as readonly string[]).includes(t);
export const stepsOf = (t: Transition): Step[] => (typeof t === "string" ? [{ to: t }] : t);
export const outcomesOf = (lane: Lane): [string, Transition][] =>
  Object.entries(lane.on).filter((e): e is [string, Transition] => e[1] !== undefined);

/** A value a condition or an input points at must exist. Returns the values it can take, when known. */
export function checkRef(
  w: Workflow,
  index: Map<string, number>,
  add: Add,
  path: string,
  ref: string,
): (string | number | boolean)[] | undefined {
  const [head, kind, name] = ref.split(".");
  if (head === "change") {
    if (!w.lanes.some((l) => l.agent?.access === "write")) {
      add(
        path,
        '"change.tier" describes a change to the code, but no lane in this workflow can write.',
        'Route on something else, or give a lane agent.access "write".',
      );
    }
    return [...CHANGE_TIERS];
  }
  if (ref === "task.source") return w.collectors.map((c) => c.id);
  if (head === "task" || !head || !name) return undefined;
  const lane = w.lanes[index.get(head) ?? -1];
  if (!lane) {
    add(
      path,
      `"${ref}" points at a lane "${head}" that does not exist.`,
      "Use the id of a lane in this workflow.",
    );
    return undefined;
  }
  if (kind === "gates") {
    if (!lane.gates?.includes(name)) {
      add(
        path,
        `Lane "${head}" does not run a gate "${name}".`,
        `Add "${name}" to that lane's "gates", or point at one it runs.`,
      );
    }
    return ["pass", "fail"];
  }
  const output = lane.outputs?.[name];
  if (!output) {
    add(
      path,
      `Lane "${head}" declares no output "${name}".`,
      `Add "${name}" to that lane's "outputs", or point at one it declares.`,
    );
    return undefined;
  }
  if (output.type === "boolean") return [true, false];
  return output.enum;
}

function checkCondition(w: Workflow, index: Map<string, number>, add: Add, path: string, when: Condition) {
  const allowed = checkRef(w, index, add, `${path}.ref`, when.ref);
  if (!allowed) return;
  const key = when.in ? "in" : "notIn";
  for (const value of when[key] ?? []) {
    if (!allowed.includes(value)) {
      add(
        `${path}.${key}`,
        `${JSON.stringify(value)} is not a value "${when.ref}" can have, so this would never match.`,
        `Use one of: ${allowed.join(", ")}.`,
      );
    }
  }
}

export function checkTransitions(w: Workflow, index: Map<string, number>, problems: Problem[]) {
  const add: Add = (path, message, fix) => problems.push({ path, message, fix });

  w.lanes.forEach((lane, i) => {
    for (const [j, m] of (lane.panel?.members ?? []).entries()) {
      if (m.when) checkCondition(w, index, add, `lanes[${i}].panel.members[${j}].when`, m.when);
    }
    if (lane.oneWay && lane.on.needsPerson === undefined) {
      add(
        `lanes[${i}].on`,
        `Lane "${lane.id}" is one-way, and by default "needsPerson" goes to "@inbox", which runs the lane again.`,
        'Add "needsPerson": "@stop".',
      );
    }
    for (const [outcome, transition] of outcomesOf(lane)) {
      const path = `lanes[${i}].on.${outcome}`;
      const steps = stepsOf(transition);
      for (const [j, step] of steps.entries()) {
        const here = typeof transition === "string" ? path : `${path}[${j}]`;
        const last = j === steps.length - 1;
        const guarded = step.when !== undefined || step.maxRounds !== undefined;
        if (last && guarded) {
          add(
            here,
            'The last entry of a transition list must be a plain default, with no "when" and no "maxRounds".',
            'Add a final entry such as { "to": "@stop" } for when nothing else applies.',
          );
        }
        if (!last && !guarded) {
          add(
            here,
            "This entry always applies, so the entries after it can never be reached.",
            'Add "when" or "maxRounds" to it, or move it to the end.',
          );
        }
        if (step.when) checkCondition(w, index, add, `${here}.when`, step.when);
        if (lane.oneWay && step.to === "@inbox") {
          add(
            here,
            `"@inbox" runs the lane again after a person answers, but lane "${lane.id}" is one-way.`,
            'Use "@stop" so a person takes over.',
          );
        }
        if (isEnd(step.to)) continue;
        const targetIndex = index.get(step.to);
        const target = w.lanes[targetIndex ?? -1];
        if (targetIndex === undefined || !target) {
          add(
            here,
            `"${step.to}" is not a lane in this workflow.`,
            `Use a lane id, or one of ${END_TARGETS.join(", ")}.`,
          );
        } else if (targetIndex <= i) {
          const crossed = w.lanes.slice(targetIndex, i + 1).find((l) => l.oneWay);
          if (crossed) {
            add(
              here,
              `Going back to "${step.to}" would run the one-way lane "${crossed.id}" a second time.`,
              "A one-way lane runs at most once in a run. End the run here, or point at a lane after it.",
            );
          } else if (step.maxRounds === undefined) {
            add(
              here,
              `This points back to "${step.to}", an earlier lane, with no maxRounds, so the loop has no limit.`,
              `Write it as [{ "to": "${step.to}", "maxRounds": 2 }, { "to": "@stop" }].`,
            );
          }
        }
      }
    }
  });

  // Every lane must be reachable from the first, and some path must finish.
  const reached = new Set<number>([0]);
  const queue = [0];
  let canFinish = false;
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const lane = w.lanes[next];
    if (!lane) continue;
    for (const [, transition] of outcomesOf(lane)) {
      for (const step of stepsOf(transition)) {
        if (step.to === "@done") canFinish = true;
        const t = index.get(step.to);
        if (t !== undefined && !reached.has(t)) {
          reached.add(t);
          queue.push(t);
        }
      }
    }
  }
  w.lanes.forEach((lane, i) => {
    if (!reached.has(i) && index.get(lane.id) === i) {
      add(`lanes[${i}]`, `Nothing leads to lane "${lane.id}".`, "Point a transition at it, or remove it.");
    }
  });
  if (!canFinish) {
    add(
      "lanes",
      "No lane can end a run at @done, so no task can ever finish.",
      'Point the last lane\'s "pass" at "@done".',
    );
  }
}
