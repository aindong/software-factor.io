// One entry point: turn unknown JSON into a checked workflow, or the list of what to change.
import type { z } from "zod";
import { checkWorkflow, type Problem } from "./check.ts";
import { WORKFLOW_VERSION, Workflow } from "./workflow.ts";

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
  const last = String(path.at(-1) ?? "");
  if (path.includes("env") || path.includes("headersEnv")) {
    return "Put only the name of an environment variable here, such as GITHUB_TOKEN. The value stays on the machine.";
  }
  if (last === "when" || path.includes("when")) {
    return 'Write the condition as data, such as { "ref": "change.tier", "in": ["ui"] }. Expressions in strings are not allowed.';
  }
  if (valueAt(input, path) === undefined) return `Add "${last}" here. It is required.`;
  return "Change this value to what docs/workflow-schema.md shows for this field.";
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
  const parsed = Workflow.safeParse(input);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .flatMap((issue) => flatten(issue))
      .map(({ path, issue }) => ({
        path: pathOf(path),
        message: issue.message,
        fix: fixFor(path, issue, input),
      }));
    return { problems };
  }
  const problems = checkWorkflow(parsed.data);
  return problems.length > 0 ? { problems } : { workflow: parsed.data, problems };
}
