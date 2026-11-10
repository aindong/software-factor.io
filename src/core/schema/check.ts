// Rules a JSON shape cannot express: references that must exist, loops that must be bounded,
// lanes that must be reachable (ADR 0005, ADR 0012). Every problem names the place and the fix.
import { type Condition, END_TARGETS, type Lane, type Transition, type Workflow } from "./workflow.ts";

export interface Problem {
  /** Where in the file, such as `lanes[2].on.fail`. */
  path: string;
  message: string;
  /** What to change. */
  fix: string;
}

export const CORE_LANES = ["core/agent@1", "core/command@1"];
export const CORE_GATES = [
  "core/command@1",
  "core/protected-paths@1",
  "core/tests-not-weakened@1",
  "core/test-floor@1",
  "core/new-tests-fail-on-base@1",
];
export const CORE_COLLECTORS = ["core/file@1", "core/github-issues@1", "core/schedule@1", "core/mcp-query@1"];

type Step = { to: string; when?: Condition; maxRounds?: number };
const isEnd = (t: string) => (END_TARGETS as readonly string[]).includes(t);
const stepsOf = (t: Transition): Step[] => (typeof t === "string" ? [{ to: t }] : t);
const outcomes = (lane: Lane): [string, Transition][] =>
  Object.entries(lane.on).filter((e): e is [string, Transition] => e[1] !== undefined);

export function checkWorkflow(w: Workflow): Problem[] {
  const problems: Problem[] = [];
  const add = (path: string, message: string, fix: string) => problems.push({ path, message, fix });

  const index = new Map<string, number>();
  w.lanes.forEach((lane, i) => {
    if (index.has(lane.id)) {
      add(
        `lanes[${i}].id`,
        `Two lanes share the id "${lane.id}".`,
        `Give lanes[${i}] an id no other lane uses.`,
      );
    } else index.set(lane.id, i);
  });
  const seen = new Set<string>();
  w.collectors.forEach((c, i) => {
    if (seen.has(c.id))
      add(`collectors[${i}].id`, `Two collectors share the id "${c.id}".`, "Give each collector its own id.");
    seen.add(c.id);
    checkUses(`collectors[${i}].uses`, c.uses, CORE_COLLECTORS, "collector");
  });
  for (const [gateId, gate] of Object.entries(w.gates ?? {})) {
    checkUses(`gates.${gateId}.uses`, gate.uses, CORE_GATES, "gate");
    const named = typeof gate.with?.run === "string" || typeof gate.with?.command === "string";
    if (gate.uses === "core/command@1" && !named) {
      add(
        `gates.${gateId}.with`,
        `Gate "${gateId}" runs a command but names none, so it could never fail.`,
        'Add "with": { "run": "<shell command>" } or { "command": "<name from factory.json>" }.',
      );
    }
  }

  function checkUses(path: string, uses: string, core: string[], kind: string) {
    const namespace = uses.split("/")[0] ?? "";
    if (namespace === "core") {
      if (!core.includes(uses))
        add(path, `There is no built-in ${kind} "${uses}".`, `Use one of: ${core.join(", ")}.`);
    } else if (!w.plugins?.[namespace]) {
      add(
        path,
        `"${uses}" comes from the plugin "${namespace}", which this workflow does not list.`,
        `Add "${namespace}": "<version range>" to "plugins".`,
      );
    }
  }

  // A value a condition or an input points at must exist.
  function checkRef(path: string, ref: string) {
    const [head, kind, name] = ref.split(".");
    if (head === "task" || head === "change" || !head || !name) return;
    const lane = w.lanes[index.get(head) ?? -1];
    if (!lane)
      return add(
        path,
        `"${ref}" points at a lane "${head}" that does not exist.`,
        "Use the id of a lane in this workflow.",
      );
    if (kind === "outputs" && !lane.outputs?.[name]) {
      add(
        path,
        `Lane "${head}" declares no output "${name}".`,
        `Add "${name}" to that lane's "outputs", or point at one it declares.`,
      );
    }
    if (kind === "gates" && !lane.gates?.includes(name)) {
      add(
        path,
        `Lane "${head}" does not run a gate "${name}".`,
        `Add "${name}" to that lane's "gates", or point at one it runs.`,
      );
    }
  }

  w.lanes.forEach((lane, i) => {
    const at = `lanes[${i}]`;
    checkUses(`${at}.uses`, lane.uses, CORE_LANES, "lane type");

    if (lane.uses === "core/agent@1" && !lane.agent) {
      add(
        `${at}.agent`,
        `Lane "${lane.id}" runs an agent but has no "agent" settings.`,
        'Add "agent" with a role, access and prompt.',
      );
    }
    if (lane.uses === "core/command@1") {
      const w2 = lane.with ?? {};
      if (typeof w2.run !== "string" && typeof w2.command !== "string") {
        add(
          `${at}.with`,
          `Lane "${lane.id}" runs a command but names none.`,
          'Add "with": { "run": "<shell command>" } or { "command": "<name from factory.json>" }.',
        );
      }
      if (lane.agent || lane.panel) {
        add(
          `${at}.agent`,
          `Lane "${lane.id}" is a command lane, so it cannot have agent or panel settings.`,
          'Remove "agent" and "panel", or change "uses" to "core/agent@1".',
        );
      }
    }
    if (lane.panel && !lane.agent) {
      add(
        `${at}.panel`,
        `Lane "${lane.id}" has a panel but no "agent" for its members to start from.`,
        'Add "agent" with the settings members share.',
      );
    }

    const roles = [lane.agent?.role, ...(lane.panel?.members.map((m) => m.role) ?? [])];
    for (const role of roles) {
      if (role && !w.roles[role]) {
        add(
          `${at}.agent.role`,
          `Role "${role}" is not declared.`,
          `Add "${role}": { "description": "..." } to "roles".`,
        );
      }
    }
    for (const name of lane.agent?.mcp ?? []) {
      if (!w.mcp?.[name])
        add(
          `${at}.agent.mcp`,
          `MCP server "${name}" is not declared.`,
          `Add "${name}" to the top-level "mcp" with where it comes from.`,
        );
    }
    for (const name of lane.agent?.skills ?? []) {
      if (!w.skills?.[name])
        add(
          `${at}.agent.skills`,
          `Skill "${name}" is not declared.`,
          `Add "${name}" to the top-level "skills" with where it comes from.`,
        );
    }
    const session = lane.agent?.session;
    if (session && session !== "new") {
      const other = w.lanes[index.get(session.continue) ?? -1];
      if (!other?.agent)
        add(
          `${at}.agent.session`,
          `"${session.continue}" is not an agent lane whose session can be continued.`,
          'Name an agent lane, or use "new".',
        );
    }
    const memberIds = lane.panel?.members.map((m) => m.id) ?? [];
    if (new Set(memberIds).size !== memberIds.length) {
      add(`${at}.panel.members`, "Two panel members share an id.", "Give each member its own id.");
    }
    for (const [j, m] of (lane.panel?.members ?? []).entries()) {
      if (m.when) checkRef(`${at}.panel.members[${j}].when.ref`, m.when.ref);
    }

    const laneGates = lane.gates ?? [];
    for (const g of laneGates) {
      if (!w.gates?.[g])
        add(
          `${at}.gates`,
          `Gate "${g}" is not defined.`,
          `Add "${g}" to the top-level "gates", or remove it here.`,
        );
    }
    if (lane.agent?.access === "write" && laneGates.length === 0) {
      add(
        `${at}.gates`,
        `Lane "${lane.id}" can change files but no gate checks its work.`,
        'Add a gate id to "gates", or set agent.access to "read".',
      );
    }
    if (laneGates.some((g) => w.gates?.[g]?.onFail === "repair") && lane.limits?.repairRounds === undefined) {
      add(
        `${at}.limits`,
        `Lane "${lane.id}" has a gate that sends work back for repair, with no limit on how often.`,
        'Add "limits": { "repairRounds": 2 }.',
      );
    }
    if (lane.oneWay && lane.checkpoint !== "in") {
      add(
        `${at}.checkpoint`,
        `Lane "${lane.id}" is one-way (it cannot be undone) but does not wait for a person.`,
        'Set "checkpoint" to "in".',
      );
    }
    for (const key of ["minutes", "tokens", "usd"] as const) {
      const [mine, top] = [lane.limits?.[key], w.limits[key]];
      if (mine !== undefined && top !== undefined && mine > top) {
        add(
          `${at}.limits.${key}`,
          `Lane "${lane.id}" allows ${mine} ${key}, more than the run's ${top}.`,
          "A lane can only lower the run's limit.",
        );
      }
    }
    for (const [name, ref] of Object.entries(lane.inputs ?? {})) checkRef(`${at}.inputs.${name}`, ref);

    for (const [outcome, transition] of outcomes(lane)) {
      const path = `${at}.on.${outcome}`;
      const steps = stepsOf(transition);
      for (const [j, step] of steps.entries()) {
        const here = typeof transition === "string" ? path : `${path}[${j}]`;
        const last = j === steps.length - 1;
        const guarded = step.when !== undefined || step.maxRounds !== undefined;
        if (last && guarded && typeof transition !== "string") {
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
        if (step.when) checkRef(`${here}.when.ref`, step.when.ref);
        if (isEnd(step.to)) continue;
        const targetIndex = index.get(step.to);
        if (targetIndex === undefined) {
          add(
            here,
            `"${step.to}" is not a lane in this workflow.`,
            `Use a lane id, or one of ${END_TARGETS.join(", ")}.`,
          );
        } else if (targetIndex <= i && step.maxRounds === undefined) {
          add(
            here,
            `This points back to "${step.to}", an earlier lane, with no maxRounds, so the loop has no limit.`,
            `Write it as [{ "to": "${step.to}", "maxRounds": 2 }, { "to": "@stop" }].`,
          );
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
    for (const [, transition] of outcomes(lane)) {
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
  if (!canFinish)
    add(
      "lanes",
      "No lane can end a run at @done, so no task can ever finish.",
      'Point the last lane\'s "pass" at "@done".',
    );

  return problems;
}
