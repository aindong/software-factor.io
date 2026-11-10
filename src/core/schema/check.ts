// Rules a JSON shape cannot express: references that must exist, settings each built-in accepts,
// who may write and who checks it (ADR 0005, ADR 0012). Every problem names the place and the fix.
import { BUILTINS, findSecrets } from "./builtins.ts";
import { checkRef, checkTransitions } from "./transitions.ts";
import type { Workflow } from "./workflow.ts";

export interface Problem {
  /** Where in the file, such as `lanes[2].on.fail`. */
  path: string;
  message: string;
  /** What to change. */
  fix: string;
}

type Kind = keyof typeof BUILTINS;
const TABLE = "See the built-ins table in docs/workflow-schema.md.";

export function checkWorkflow(w: Workflow): Problem[] {
  const problems: Problem[] = [];
  const add = (path: string, message: string, fix: string) => problems.push({ path, message, fix });

  // What something is (`uses`) must be a built-in or come from a listed plugin, and its settings must fit.
  function checkUses(kind: Kind, path: string, uses: string, settings: unknown) {
    const namespace = uses.split("/")[0] ?? "";
    if (namespace !== "core") {
      if (!w.plugins?.[namespace]) {
        add(
          `${path}.uses`,
          `"${uses}" comes from the plugin "${namespace}", which this workflow does not list.`,
          `Add "${namespace}": "<version range>" to "plugins".`,
        );
      }
      return;
    }
    const known = BUILTINS[kind];
    if (!(uses in known)) {
      add(
        `${path}.uses`,
        `There is no built-in ${kind} "${uses}".`,
        `Use one of: ${Object.keys(known).join(", ")}.`,
      );
      return;
    }
    const schema = known[uses];
    if (!schema) {
      if (settings !== undefined) add(`${path}.with`, `"${uses}" takes no settings.`, 'Remove "with".');
      return;
    }
    const parsed = schema.safeParse(settings);
    if (parsed.success) return;
    for (const issue of parsed.error.issues) {
      const where = issue.path.reduce<string>(
        (p, k) => (typeof k === "number" ? `${p}[${k}]` : `${p}.${String(k)}`),
        `${path}.with`,
      );
      let fix = `Set "${String(issue.path.at(-1) ?? "with")}" as "${uses}" expects. ${TABLE}`;
      if (issue.code === "unrecognized_keys")
        fix = `Remove ${issue.keys.map((k) => `"${k}"`).join(", ")}. ${TABLE}`;
      else if (issue.code === "custom") fix = issue.message;
      else if (settings === undefined) fix = `Add "with" for "${uses}". ${TABLE}`;
      add(where, `The settings for "${uses}" are not valid: ${issue.message}`, fix);
    }
  }

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

  const collectorIds = new Set<string>();
  w.collectors.forEach((c, i) => {
    if (collectorIds.has(c.id)) {
      add(`collectors[${i}].id`, `Two collectors share the id "${c.id}".`, "Give each collector its own id.");
    }
    collectorIds.add(c.id);
    checkUses("collector", `collectors[${i}]`, c.uses, c.with);
    const server = c.uses === "core/mcp-query@1" ? c.with?.server : undefined;
    if (typeof server === "string" && !w.mcp?.[server]) {
      add(
        `collectors[${i}].with.server`,
        `MCP server "${server}" is not declared.`,
        `Add "${server}" to the top-level "mcp" with where it comes from.`,
      );
    }
  });
  for (const [gateId, gate] of Object.entries(w.gates ?? {})) {
    checkUses("gate", `gates.${gateId}`, gate.uses, gate.with);
  }

  for (const [role, def] of Object.entries(w.roles)) {
    for (const other of def.differentVendorFrom ?? []) {
      if (!w.roles[other] || other === role) {
        add(
          `roles.${role}.differentVendorFrom`,
          `"${other}" is not another declared role.`,
          `Name a role declared in "roles" other than "${role}".`,
        );
      }
    }
  }
  for (const path of findSecrets(w)) {
    add(
      path,
      "This looks like a secret. A workflow is meant to be shared.",
      "Remove it. Keep the value in an environment variable on the machine and name the variable instead.",
    );
  }

  w.lanes.forEach((lane, i) => {
    const at = `lanes[${i}]`;
    checkUses("lane", at, lane.uses, lane.with);
    const isAgent = lane.uses === "core/agent@1";

    if (isAgent && !lane.agent) {
      add(
        `${at}.agent`,
        `Lane "${lane.id}" runs an agent but has no "agent" settings.`,
        'Add "agent" with a role, access and prompt.',
      );
    }
    if (lane.uses.startsWith("core/") && !isAgent && (lane.agent || lane.panel)) {
      add(
        `${at}.agent`,
        `Lane "${lane.id}" does not run an agent, so it cannot have agent or panel settings.`,
        'Remove "agent" and "panel", or change "uses" to "core/agent@1".',
      );
    }

    const declared = (role: string | undefined, path: string) => {
      if (role && !w.roles[role]) {
        add(path, `Role "${role}" is not declared.`, `Add "${role}": { "description": "..." } to "roles".`);
      }
    };
    declared(lane.agent?.role, `${at}.agent.role`);
    for (const [kind, names, known] of [
      ["MCP server", lane.agent?.mcp ?? [], w.mcp ?? {}],
      ["Skill", lane.agent?.skills ?? [], w.skills ?? {}],
    ] as const) {
      const key = kind === "Skill" ? "skills" : "mcp";
      for (const name of names) {
        if (!(name in known)) {
          add(
            `${at}.agent.${key}`,
            `${kind} "${name}" is not declared.`,
            `Add "${name}" to the top-level "${key}" with where it comes from.`,
          );
        }
      }
    }

    const session = lane.agent?.session;
    if (session && session !== "new") {
      const other = w.lanes[index.get(session.continue) ?? -1];
      if (!other?.agent || other.id === lane.id || other.agent.role !== lane.agent?.role) {
        add(
          `${at}.agent.session`,
          `Lane "${lane.id}" cannot continue the session of "${session.continue}".`,
          'Name another agent lane with the same role (a session belongs to one account), or use "new".',
        );
      }
    }

    if (lane.panel) {
      const members = lane.panel.members;
      if (lane.agent?.access === "write") {
        add(
          `${at}.panel`,
          `Lane "${lane.id}" has a panel that can change files. Members share one worktree and would collide.`,
          'Set agent.access to "read". Two agents writing at once is not supported yet.',
        );
      }
      if (new Set(members.map((m) => m.id)).size !== members.length) {
        add(`${at}.panel.members`, "Two panel members share an id.", "Give each member its own id.");
      }
      if (members.every((m) => m.advisory)) {
        add(
          `${at}.panel.members`,
          "Every member is advisory, so nobody decides the outcome.",
          'Remove "advisory" from at least one member.',
        );
      }
      members.forEach((m, j) => {
        declared(m.role, `${at}.panel.members[${j}].role`);
      });
    }

    const laneGates = lane.gates ?? [];
    for (const g of laneGates) {
      if (!w.gates?.[g]) {
        add(
          `${at}.gates`,
          `Gate "${g}" is not defined.`,
          `Add "${g}" to the top-level "gates", or remove it here.`,
        );
      }
    }
    if (lane.agent?.access === "write" && laneGates.length === 0) {
      add(
        `${at}.gates`,
        `Lane "${lane.id}" can change files but no gate checks its work.`,
        'Add a gate id to "gates", or set agent.access to "read".',
      );
    }
    const repairs = laneGates.filter((g) => w.gates?.[g]?.onFail === "repair");
    if (repairs.length > 0 && !lane.agent) {
      add(
        `${at}.gates`,
        `Gate "${repairs[0]}" sends its output back for repair, but lane "${lane.id}" has no agent to repair anything.`,
        'Use a gate whose onFail is "fail" or "stop" here: define a second gate without "repair".',
      );
    } else if (repairs.length > 0 && lane.limits?.repairRounds === undefined) {
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
    if (lane.oneWay && (lane.retry?.max ?? 0) > 0) {
      add(
        `${at}.retry`,
        `Lane "${lane.id}" is one-way, so restarting it after a crash could do the thing twice.`,
        'Remove "retry", or set its max to 0.',
      );
    }

    for (const key of ["minutes", "tokens", "usd"] as const) {
      const [mine, top] = [lane.limits?.[key], w.limits[key]];
      if (mine !== undefined && top === undefined) {
        add(
          `${at}.limits.${key}`,
          `Lane "${lane.id}" sets a ${key} limit but the run has none.`,
          `Set the run's "limits.${key}" first. A lane can only lower it.`,
        );
      } else if (mine !== undefined && top !== undefined && mine > top) {
        add(
          `${at}.limits.${key}`,
          `Lane "${lane.id}" allows ${mine} ${key}, more than the run's ${top}.`,
          "A lane can only lower the run's limit.",
        );
      }
    }
    for (const [name, ref] of Object.entries(lane.inputs ?? {})) {
      if (ref.startsWith(`${lane.id}.`)) {
        add(
          `${at}.inputs.${name}`,
          `Lane "${lane.id}" takes its own value as an input.`,
          "Point at a value from another lane.",
        );
      } else checkRef(w, index, add, `${at}.inputs.${name}`, ref);
    }
  });

  checkTransitions(w, index, problems);
  return problems;
}
