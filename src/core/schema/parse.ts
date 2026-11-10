// One entry point: turn unknown JSON into a checked workflow, or the list of what to change.
import type { z } from "zod";
import { checkWorkflow, type Problem } from "./check.ts";
import { SCHEMA_URL, WORKFLOW_VERSION, Workflow } from "./workflow.ts";

export type { Problem } from "./check.ts";

export interface ParseResult {
  /** Present only when there are no problems. */
  workflow?: Workflow;
  problems: Problem[];
}

type Issue = z.core.$ZodIssue;

const pathOf = (path: PropertyKey[]) =>
  path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`)).join("") ||
  "(top)";

// A union reports one issue per option it tried. Keep the option that got furthest into the file:
// that is the one the author most likely meant.
function flatten(issue: Issue, base: PropertyKey[] = []): { path: PropertyKey[]; issue: Issue }[] {
  const path = [...base, ...issue.path];
  if (issue.code === "invalid_union" && issue.errors.length > 0) {
    const options = issue.errors.map((errs) => errs.flatMap((e) => flatten(e, path)));
    const depth = (o: { path: PropertyKey[] }[]) => Math.max(0, ...o.map((x) => x.path.length));
    const best = options.reduce((a, b) => (depth(b) > depth(a) ? b : a));
    if (best.length > 0) return best;
  }
  return [{ path, issue }];
}

const valueAt = (input: unknown, path: PropertyKey[]) =>
  path.reduce<unknown>((v, key) => (v as Record<PropertyKey, unknown> | undefined)?.[key], input);

function fixFor(path: PropertyKey[], issue: Issue, input: unknown): string {
  if (issue.code === "unrecognized_keys") {
    if (issue.keys.includes("account")) {
      return 'A workflow names roles, never accounts. Remove "account", use "role", and bind the role to an account on each machine.';
    }
    return `Remove ${issue.keys.map((k) => `"${k}"`).join(", ")}, or check the spelling against docs/workflow-schema.md.`;
  }
  if (issue.code === "custom") return issue.message;
  if (issue.code === "invalid_key") {
    const parent = String(path.at(-2) ?? "");
    if (parent === "inputs" || parent === "outputs") {
      return 'Name it with letters and digits only, starting with a lowercase letter, such as "planPath".';
    }
    if (parent === "commands") {
      return 'Start the name with a letter and use letters, digits, ".", ":", "_" and "-", such as "test:e2e".';
    }
    return 'Name it with lowercase letters, digits and dashes, starting with a letter, such as "open-pr".';
  }
  const last = String(path.at(-1) ?? "");
  const value = valueAt(input, path);
  if (value === undefined) return `Add "${last}" here. It is required.`;
  if (path.includes("env") || path.includes("headersEnv")) {
    return "Put only the name of an environment variable here, such as GITHUB_TOKEN. The value stays on the machine.";
  }
  if (last === "ref") {
    return "Use one of: task.source, task.labels, change.tier, <lane>.outputs.<name>, <lane>.gates.<gate>.";
  }
  if (last === "when") {
    return 'Write the condition as data, such as { "ref": "change.tier", "in": ["ui"] }. Expressions in strings are not allowed.';
  }
  if (last === "id" || last === "to" || (last === "name" && path.length === 1)) {
    return 'Use lowercase letters, digits and dashes, starting with a letter, such as "open-pr".';
  }
  if (last === "version") return `Write "version": ${WORKFLOW_VERSION}, as a number.`;
  if (last === "$schema") return `Set "$schema" to "${SCHEMA_URL}".`;
  if (path.at(-2) === "on") {
    return 'Write a lane id such as "build", an end such as "@done", or a list such as [{ "to": "build" }].';
  }
  return "Change this value to what docs/workflow-schema.md shows for this field.";
}

// Zod's own wording quotes patterns and names types the author never chose. Say it plainly.
function messageFor(path: PropertyKey[], issue: Issue): string {
  if (issue.code === "custom") return "This is not valid as written.";
  if (issue.code === "invalid_key") return "This name is not allowed.";
  if (issue.code === "invalid_format") return "This value is not in the form this field needs.";
  if (path.at(-2) === "on") return "This must be a lane id, an end such as @done, or a list of entries.";
  return issue.message;
}

/** The path of every key named "__proto__" in a value read from JSON. */
function protoKeys(value: unknown, path = "", depth = 0): string[] {
  if (typeof value !== "object" || value === null || depth > 40) return [];
  if (Array.isArray(value)) return value.flatMap((v, i) => protoKeys(v, `${path}[${i}]`, depth + 1));
  return Object.keys(value).flatMap((key) => {
    const here = path ? `${path}.${key}` : key;
    return key === "__proto__" ? [here] : protoKeys((value as Record<string, unknown>)[key], here, depth + 1);
  });
}

export function parseWorkflow(input: unknown): ParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      problems: [
        {
          path: "(top)",
          message: "A workflow must be a JSON object.",
          fix: "Start from one of the files in workflows/.",
        },
      ],
    };
  }
  const version = (input as { version?: unknown }).version;
  if (typeof version === "number" && version > WORKFLOW_VERSION) {
    return {
      problems: [
        {
          path: "version",
          message: `This file is version ${version}. This softwarefactor reads version ${WORKFLOW_VERSION}.`,
          fix: "Upgrade softwarefactor, then try again.",
        },
      ],
    };
  }
  // A key named "__proto__" is skipped by the schema library, so nothing would check what is
  // under it. A workflow has no use for one.
  const hidden = protoKeys(input);
  if (hidden.length > 0) {
    return {
      problems: hidden.map((path) => ({
        path,
        message: 'A key named "__proto__" is not allowed: the checker cannot see what is under it.',
        fix: "Remove the key, or give it another name.",
      })),
    };
  }
  const parsed = Workflow.safeParse(input);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .flatMap((issue) => flatten(issue))
      .map(({ path, issue }) => ({
        path: pathOf(path),
        message: messageFor(path, issue),
        fix: fixFor(path, issue, input),
      }));
    const seen = new Set<string>();
    return {
      problems: problems.filter(
        (p) => !seen.has(p.path + p.message + p.fix) && seen.add(p.path + p.message + p.fix),
      ),
    };
  }
  const problems = checkWorkflow(parsed.data);
  return problems.length > 0 ? { problems } : { workflow: parsed.data, problems };
}
