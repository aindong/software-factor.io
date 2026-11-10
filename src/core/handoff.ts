// The hand-off a lane leaves: what it did, a claim for each thing it asserts with evidence the host
// can find, what is still open, and the risk. The host checks it before anything is done with it
// (ADR 0006): a claim with no evidence, or with evidence that does not exist, is rejected.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { saveRunFile } from "./evidence.ts";
import { git } from "./git.ts";
import type { Lane } from "./schema/workflow.ts";
import type { Workspace } from "./workspace.ts";

export const Risk = z.strictObject({
  level: z.enum(["low", "medium", "high"]),
  door: z
    .enum(["two-way", "one-way"])
    .meta({ description: "two-way: undoing the change undoes its effect. one-way: it cannot be undone." }),
  why: z.string().min(1),
  blastRadius: z
    .string()
    .min(1)
    .optional()
    .meta({ description: "What breaks, and who notices, if this is wrong." }),
});

export const Handoff = z.strictObject({
  outcome: z.enum(["pass", "fail", "needsPerson"]),
  summary: z
    .string()
    .min(1)
    .meta({ description: "What was done, or the question for a person, in a sentence or two." }),
  claims: z
    .array(z.strictObject({ text: z.string().min(1), evidence: z.array(z.string().min(1)).min(1) }))
    .optional()
    .meta({
      description:
        "Each thing the lane asserts, with evidence: commit:<rev>, file:<path>, attached:<name> or gate:<lane>.<gate>.",
    }),
  open: z.array(z.string().min(1)).optional().meta({ description: "What is still open or unsure." }),
  risk: Risk.optional(),
  outputs: z.record(z.string(), z.unknown()).optional(),
});
export type Handoff = z.infer<typeof Handoff>;
export type RunRisk = z.infer<typeof Risk> & { raised: string[] };

export interface ResolvedEvidence {
  ref: string;
  ok: boolean;
  /** For an attached file: the host's copy, relative to the workspace. */
  path?: string;
  sha256?: string;
}
export interface CheckContext {
  ws: Workspace;
  runId: string;
  /** "<seq>-<lane>" plus the attempt, the prefix for files of this hand-off. */
  tag: string;
  base: string;
  head: string;
  /** Gate results so far in this run, by lane then gate. */
  gates: Record<string, Record<string, string>>;
  /** Where the agent may leave files as evidence. */
  evidenceDir: string;
}

const MAX_ATTACHMENT = 20_000_000;
const at = (path: PropertyKey[]) =>
  path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`)).join("") ||
  "(top)";

/** What is wrong with the hand-off's shape, each with what to change. */
function shapeProblems(value: unknown): string[] {
  const parsed = Handoff.safeParse(value);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => {
    const where = at(issue.path);
    if (issue.code === "unrecognized_keys")
      return `${where}: ${issue.keys.map((k) => `"${k}"`).join(", ")} is not part of a hand-off. Remove it.`;
    if (/\.evidence$/.test(where))
      return `${where}: every claim needs at least one piece of evidence the host can check (commit:, file:, attached: or gate:).`;
    if (where === "summary") return "summary: say what was done in a sentence or two.";
    if (where === "outcome") return "outcome: must be pass, fail or needsPerson.";
    return `${where}: ${issue.message}`;
  });
}

/** The lane's declared outputs against what the hand-off gives. */
function outputProblems(lane: Lane, outputs: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const declared = lane.outputs ?? {};
  for (const [name, def] of Object.entries(declared)) {
    const value = outputs[name];
    if (value === undefined) {
      if (def.required) problems.push(`outputs.${name}: the lane requires this output, and it is missing.`);
      continue;
    }
    const type = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    if (type !== def.type) problems.push(`outputs.${name}: must be a ${def.type}, not a ${type}.`);
    else if (def.enum && !def.enum.includes(String(value)))
      problems.push(`outputs.${name}: ${JSON.stringify(value)} is not one of ${def.enum.join(", ")}.`);
  }
  for (const name of Object.keys(outputs)) {
    if (!Object.hasOwn(declared, name))
      problems.push(
        `outputs.${name}: the lane declares no output "${name}". Remove it, or declare it in the workflow.`,
      );
  }
  return problems;
}

const isAncestor = (root: string, a: string, b: string) => {
  try {
    git(root, "merge-base", "--is-ancestor", a, b);
    return true;
  } catch {
    return false;
  }
};

/** Find one piece of evidence. Returns why it could not be found, when it could not. */
function resolve(c: CheckContext, ref: string): ResolvedEvidence & { why?: string } {
  const colon = ref.indexOf(":");
  const [kind, rest] = colon < 0 ? ["", ref] : [ref.slice(0, colon), ref.slice(colon + 1)];
  if (kind === "commit") {
    let sha: string;
    try {
      sha =
        rest === "HEAD"
          ? c.head
          : git(c.ws.root, "rev-parse", "--verify", "--end-of-options", `${rest}^{commit}`);
    } catch {
      return { ref, ok: false, why: `the commit "${rest}" does not exist` };
    }
    const ours = isAncestor(c.ws.root, sha, c.head) && !isAncestor(c.ws.root, sha, c.base);
    return ours
      ? { ref, ok: true }
      : { ref, ok: false, why: `the commit "${rest}" was not made in this run` };
  }
  if (kind === "file") {
    try {
      git(c.ws.root, "cat-file", "-e", `${c.head}:${rest}`);
      return { ref, ok: true };
    } catch {
      return { ref, ok: false, why: `"${rest}" is not a committed file at the run's head` };
    }
  }
  if (kind === "attached") {
    const source = join(c.evidenceDir, rest);
    const plain = !/[\\/]/.test(rest) && rest !== "" && !rest.startsWith(".");
    if (
      !plain ||
      !existsSync(source) ||
      !lstatSync(source).isFile() ||
      statSync(source).size > MAX_ATTACHMENT
    ) {
      return {
        ref,
        ok: false,
        why: `no file "${rest}" was attached (put it in the evidence folder, under 20 MB)`,
      };
    }
    // the host keeps its own copy: the record never points at a file an agent can change later
    const saved = saveRunFile(c.ws, c.runId, "evidence", `${c.tag}-attached-${rest}`, "");
    copyFileSync(source, join(c.ws.root, saved.path));
    return {
      ref,
      ok: true,
      path: saved.path,
      sha256: createHash("sha256")
        .update(readFileSync(join(c.ws.root, saved.path)))
        .digest("hex"),
    };
  }
  if (kind === "gate") {
    const [lane, gate] = rest.split(".");
    const passed = lane !== undefined && gate !== undefined && c.gates[lane]?.[gate] === "pass";
    return passed
      ? { ref, ok: true }
      : { ref, ok: false, why: `the gate "${rest}" has not passed in this run` };
  }
  return {
    ref,
    ok: false,
    why: `"${ref}" is not evidence the host can check. Use commit:<rev>, file:<path>, attached:<name> or gate:<lane>.<gate>`,
  };
}

export interface CheckedHandoff {
  handoff?: Handoff;
  /** Each accepted claim with its evidence resolved. */
  claims: { text: string; evidence: ResolvedEvidence[] }[];
  problems: string[];
}

/** Check a hand-off an agent left. With no problems, it is accepted and its attached files are copied. */
export function checkHandoff(c: CheckContext, lane: Lane, value: unknown): CheckedHandoff {
  const problems = shapeProblems(value);
  if (problems.length > 0) return { claims: [], problems };
  const handoff = Handoff.parse(value);
  problems.push(...outputProblems(lane, handoff.outputs ?? {}));
  const claims = (handoff.claims ?? []).map((claim, i) => {
    const evidence = claim.evidence.map((ref) => resolve(c, ref));
    for (const e of evidence) if (!e.ok) problems.push(`claims[${i}] ("${claim.text}"): ${e.why}.`);
    return {
      text: claim.text,
      evidence: evidence.map(({ ref, ok, path, sha256 }) => ({ ref, ok, path, sha256 })),
    };
  });
  return problems.length > 0 ? { claims: [], problems } : { handoff, claims, problems };
}

const LEVELS = ["low", "medium", "high"] as const;

/** The run's risk after one more lane stated one. The host raises "low" where it knows better. */
export function combineRisk(
  previous: RunRisk | undefined,
  stated: z.infer<typeof Risk>,
  facts: { tier: string; oneWayLane: boolean },
): RunRisk {
  const higher = !previous || LEVELS.indexOf(stated.level) >= LEVELS.indexOf(previous.level);
  const risk: RunRisk = {
    level: higher ? stated.level : previous.level,
    door:
      stated.door === "one-way" || previous?.door === "one-way" || facts.oneWayLane ? "one-way" : "two-way",
    why: higher ? stated.why : previous.why,
    blastRadius: (higher ? stated.blastRadius : previous.blastRadius) ?? previous?.blastRadius,
    raised: previous?.raised ?? [],
  };
  if (risk.level === "low") {
    const reasons = [
      risk.door === "one-way" ? "a one-way door is never low risk" : "",
      facts.tier === "sensitive" ? "the change touches sensitive files" : "",
    ].filter(Boolean);
    if (reasons.length > 0) {
      risk.level = "medium";
      risk.raised = [...new Set([...risk.raised, ...reasons])];
    }
  }
  return risk;
}
