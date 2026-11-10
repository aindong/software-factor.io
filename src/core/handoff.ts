// The hand-off a lane leaves: what it did, a claim for each thing it asserts with evidence the host
// can find, what is still open, and the risk. The host checks it before anything is done with it
// (ADR 0006): a claim with no evidence, or with evidence that does not exist, is rejected.
// Everything in a hand-off is text an agent controls, so every field is bounded.
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { saveRunFile } from "./evidence.ts";
import { git } from "./git.ts";
import type { Lane } from "./schema/workflow.ts";
import type { Workspace } from "./workspace.ts";

export const Risk = z.strictObject({
  level: z.enum(["low", "medium", "high"]),
  door: z.enum(["two-way", "one-way"]).meta({
    description: "two-way: undoing the change undoes its effect. one-way: it cannot be undone.",
  }),
  why: z.string().min(1).max(500),
  blastRadius: z.string().min(1).max(500).optional().meta({
    description: "What breaks, and who notices, if this is wrong.",
  }),
});

const Claim = z.strictObject({
  text: z.string().min(1).max(1000),
  evidence: z.array(z.string().min(1).max(300)).min(1).max(10),
});

export const Handoff = z.strictObject({
  outcome: z.enum(["pass", "fail", "needsPerson"]),
  summary: z.string().min(1).max(4000).meta({
    description: "What was done, or the question for a person, in a sentence or two.",
  }),
  claims: z.array(Claim).max(50).optional().meta({
    description:
      "Each thing the lane asserts, with evidence: commit:<id or HEAD>, file:<path>, attached:<name> or gate:<lane>.<gate>.",
  }),
  open: z
    .array(z.string().min(1).max(500))
    .max(50)
    .optional()
    .meta({ description: "What is still open or unsure." }),
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
  ws: Pick<Workspace, "root" | "runsDir">;
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
const MAX_ATTACHMENTS = 20;
const MAX_ATTACHED_TOTAL = 50_000_000;
const MAX_DEPTH = 16;
const MAX_OUTPUT_CHARS = 100_000;

const at = (path: PropertyKey[]) =>
  path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`)).join("") ||
  "(top)";

/** What is wrong with the hand-off's shape, each with what to change. */
function shapeProblems(value: unknown): string[] {
  const parsed = Handoff.safeParse(value);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => {
    const where = at(issue.path);
    if (issue.code === "unrecognized_keys") {
      return `${where}: ${issue.keys.map((k) => `"${k}"`).join(", ")} is not part of a hand-off. Remove it.`;
    }
    if (/\.evidence$/.test(where)) {
      return `${where}: every claim needs between 1 and 10 pieces of evidence the host can check (commit:, file:, attached: or gate:).`;
    }
    if (where === "summary")
      return "summary: say what was done in a sentence or two (at most 4000 characters).";
    if (where === "outcome") return "outcome: must be pass, fail or needsPerson.";
    return `${where}: ${issue.message}`;
  });
}

/** How deeply a value nests, counted without recursion so a hostile value cannot exhaust the stack. */
function depthOf(value: unknown): number {
  let level: unknown[] = [value];
  let depth = 0;
  while (level.length > 0 && depth <= MAX_DEPTH) {
    level = level.flatMap((v) => (typeof v === "object" && v !== null ? Object.values(v) : []));
    depth += 1;
  }
  return depth;
}

/** The lane's declared outputs against the values given. */
export function outputProblems(lane: Lane, outputs: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const declared = lane.outputs ?? {};
  for (const [name, def] of Object.entries(declared)) {
    const value = outputs[name];
    if (value === undefined) {
      if (def.required) problems.push(`outputs.${name}: the lane requires this output, and it is missing.`);
      continue;
    }
    if (depthOf(value) > MAX_DEPTH) {
      problems.push(`outputs.${name}: nested more than ${MAX_DEPTH} levels deep. Flatten it.`);
      continue;
    }
    if (JSON.stringify(value).length > MAX_OUTPUT_CHARS) {
      problems.push(
        `outputs.${name}: larger than ${MAX_OUTPUT_CHARS} characters. Put large content in a file and give its path.`,
      );
      continue;
    }
    const type = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    if (type !== def.type) problems.push(`outputs.${name}: must be a ${def.type}, not a ${type}.`);
    else if (def.enum && !def.enum.includes(String(value))) {
      problems.push(`outputs.${name}: ${JSON.stringify(value)} is not one of ${def.enum.join(", ")}.`);
    }
  }
  for (const name of Object.keys(outputs)) {
    if (!Object.hasOwn(declared, name)) {
      problems.push(
        `outputs.${name}: the lane declares no output "${name}". Remove it, or declare it in the workflow.`,
      );
    }
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

/** A file the agent attached, opened so that what was checked is what is copied. */
interface Attachment {
  name: string;
  fd: number;
  size: number;
}

/**
 * Open an attached file for reading. The agent owns the folder, so nothing about it is taken on
 * trust: the folder must be a real folder where the host put it, and the file a plain file with one
 * name (not a link to, or another name for, a file somewhere else).
 */
function openAttachment(evidenceDir: string, name: string): Attachment | string {
  const missing = `no file "${name}" was attached (put it in the evidence folder, as a plain file under 20 MB)`;
  if (/[\\/]/.test(name) || name === "" || name.startsWith(".")) return missing;
  let fd: number | undefined;
  try {
    const real = join(realpathSync(dirname(evidenceDir)), basename(evidenceDir));
    if (!lstatSync(evidenceDir).isDirectory() || realpathSync(evidenceDir) !== real) return missing;
    fd = openSync(join(evidenceDir, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_ATTACHMENT) {
      closeSync(fd);
      return missing;
    }
    return { name, fd, size: stat.size };
  } catch {
    if (fd !== undefined) closeSync(fd);
    return missing;
  }
}

/** Find one piece of evidence that is not an attached file. Says why, when it cannot be found. */
function resolve(c: CheckContext, ref: string): ResolvedEvidence & { why?: string } {
  const colon = ref.indexOf(":");
  const [kind, rest] = colon < 0 ? ["", ref] : [ref.slice(0, colon), ref.slice(colon + 1)];
  if (kind === "commit") {
    // HEAD is the run's branch as the repository has it. Anything else must be a commit id, so a
    // name is never looked up in the person's own checkout.
    if (rest !== "HEAD" && !/^[0-9a-f]{7,40}$/.test(rest)) {
      return { ref, ok: false, why: `"${rest}" is not HEAD or a commit id` };
    }
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
      if (rest !== "" && git(c.ws.root, "cat-file", "-t", `${c.head}:${rest}`) === "blob")
        return { ref, ok: true };
    } catch {
      // not there
    }
    return { ref, ok: false, why: `"${rest}" is not a committed file at the run's head` };
  }
  if (kind === "gate") {
    const [lane, gate] = rest.split(".");
    const results = lane !== undefined && Object.hasOwn(c.gates, lane) ? c.gates[lane] : undefined;
    const passed =
      gate !== undefined && results !== undefined && Object.hasOwn(results, gate) && results[gate] === "pass";
    return passed
      ? { ref, ok: true }
      : { ref, ok: false, why: `the gate "${rest}" has not passed in this run` };
  }
  return {
    ref,
    ok: false,
    why: `"${ref}" is not evidence the host can check. Use commit:<id or HEAD>, file:<path>, attached:<name> or gate:<lane>.<gate>`,
  };
}

export interface CheckedHandoff {
  handoff?: Handoff;
  /** Each accepted claim with its evidence resolved. */
  claims: { text: string; evidence: ResolvedEvidence[] }[];
  problems: string[];
}

/** Check a hand-off an agent left. Only when nothing is wrong is it accepted and are its attached files copied. */
export function checkHandoff(c: CheckContext, lane: Lane, value: unknown): CheckedHandoff {
  const problems = shapeProblems(value);
  if (problems.length > 0) return { claims: [], problems };
  const handoff = Handoff.parse(value);
  problems.push(...outputProblems(lane, handoff.outputs ?? {}));

  const attachments = new Map<string, Attachment>();
  try {
    const claims = (handoff.claims ?? []).map((claim, i) => {
      const evidence = claim.evidence.map((ref): ResolvedEvidence & { why?: string } => {
        if (!ref.startsWith("attached:")) return resolve(c, ref);
        const name = ref.slice("attached:".length);
        if (!attachments.has(name)) {
          if (attachments.size >= MAX_ATTACHMENTS) {
            return { ref, ok: false, why: `a hand-off may attach at most ${MAX_ATTACHMENTS} files` };
          }
          const opened = openAttachment(c.evidenceDir, name);
          if (typeof opened === "string") return { ref, ok: false, why: opened };
          attachments.set(name, opened);
        }
        return { ref, ok: true };
      });
      for (const e of evidence) if (!e.ok) problems.push(`claims[${i}] ("${claim.text}"): ${e.why}.`);
      return { text: claim.text, evidence };
    });
    const total = [...attachments.values()].reduce((n, a) => n + a.size, 0);
    if (total > MAX_ATTACHED_TOTAL) {
      problems.push(
        `The attached files are ${total} bytes together. The most a hand-off may attach is ${MAX_ATTACHED_TOTAL}.`,
      );
    }
    if (problems.length > 0) return { claims: [], problems };

    // Everything holds, so the host now takes its own copy of each attached file. The record never
    // points at a file an agent can change later.
    const copies = new Map<string, { path: string; sha256: string }>();
    let n = 0;
    for (const a of attachments.values()) {
      n += 1;
      const ext = /\.[A-Za-z0-9]{1,8}$/.exec(a.name)?.[0] ?? "";
      copies.set(
        a.name,
        saveRunFile(c.ws, c.runId, "evidence", `${c.tag}-attached-${n}${ext}`, readFileSync(a.fd)),
      );
    }
    return {
      handoff,
      problems,
      claims: claims.map((claim) => ({
        text: claim.text,
        evidence: claim.evidence.map(({ ref }) => ({
          ref,
          ok: true,
          ...copies.get(ref.slice("attached:".length)),
        })),
      })),
    };
  } finally {
    for (const a of attachments.values()) closeSync(a.fd);
  }
}

const LEVELS = ["low", "medium", "high"] as const;

/** The run's risk after one more lane stated one. The host raises "low" where it knows better. */
export function combineRisk(
  previous: RunRisk | undefined,
  stated: z.infer<typeof Risk>,
  facts: { tier: string; oneWayLane: boolean },
): RunRisk {
  // only a strictly higher level replaces the reason: a later lane cannot rewrite why the run is risky
  const higher = !previous || LEVELS.indexOf(stated.level) > LEVELS.indexOf(previous.level);
  const risk: RunRisk = {
    level: higher ? stated.level : previous.level,
    door:
      stated.door === "one-way" || previous?.door === "one-way" || facts.oneWayLane ? "one-way" : "two-way",
    why: higher ? stated.why : previous.why,
    blastRadius: higher ? stated.blastRadius : previous.blastRadius,
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
