// core/plan-contract@1: the plan a lane handed off says how each acceptance criterion is proved. The
// plan is a file in the lane's commit, read from the clean checkout and never from outside it.
// It needs a heading "Acceptance criteria" with numbered items, a heading "Verification contract",
// and for each criterion exactly one line "- <n>: <kind>:<what>". A test's path is what comes
// before the first space, so a test name may follow it.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { type GateJob, record } from "./types.ts";

const KINDS = ["test", "cmd", "ui", "human"];

/** The lines under the heading `title`, up to the next heading of the same or a higher level. */
function section(lines: string[], title: string): string[] | undefined {
  const heading = (l: string) => /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
  const at = lines.findIndex((l) => heading(l)?.[2]?.replace(/:$/, "").toLowerCase() === title.toLowerCase());
  if (at < 0) return undefined;
  const level = heading(lines[at] ?? "")?.[1]?.length ?? 1;
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => (heading(l)?.[1]?.length ?? 9) <= level);
  return end < 0 ? rest : rest.slice(0, end);
}

/** What is wrong with the plan file `planPath` of the checkout `root`, in plain words. Empty when nothing is. */
export function planProblems(root: string, planPath: string): string[] {
  const full = resolve(root, planPath);
  const inside = (p: string) =>
    !isAbsolute(relative(realpathSync(root), p)) && !relative(realpathSync(root), p).startsWith("..");
  if (!existsSync(full))
    return [`The plan "${planPath}" is not a file in the commit. Write it and commit it.`];
  if (!inside(realpathSync(full)))
    return [`The plan "${planPath}" is outside the checkout. Name a file of the repository.`];
  if (!statSync(full).isFile()) return [`The plan "${planPath}" is not a file in the commit.`];
  const lines = readFileSync(full, "utf8").split("\n");

  const problems: string[] = [];
  const criteriaLines = section(lines, "Acceptance criteria");
  const contractLines = section(lines, "Verification contract");
  if (!criteriaLines) problems.push('The plan has no "Acceptance criteria" heading.');
  if (!contractLines) problems.push('The plan has no "Verification contract" heading.');
  const criteria = (criteriaLines ?? []).flatMap((l) => /^\s*(\d+)[.)]\s+\S/.exec(l)?.[1] ?? []);
  if (criteriaLines && criteria.length === 0)
    problems.push('The "Acceptance criteria" section has no numbered item. Number each one: "1. ...".');
  if (!contractLines || criteria.length === 0) return problems;

  const checks = new Map<string, number>();
  for (const raw of contractLines) {
    const line = raw.trim();
    const m = /^[-*]\s*(\d+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, n = "", rest = ""] = m;
    if (!criteria.includes(n)) {
      problems.push(`"${line}" names criterion ${n}, which the plan does not have.`);
      continue;
    }
    checks.set(n, (checks.get(n) ?? 0) + 1);
    const colon = rest.indexOf(":");
    const kind = colon < 0 ? "" : rest.slice(0, colon).trim();
    const what = colon < 0 ? "" : rest.slice(colon + 1).trim();
    if (colon < 0) problems.push(`"${line}" must be of the form "- <n>: <kind>:<what>".`);
    else if (!KINDS.includes(kind))
      problems.push(
        `"${line}" has the kind "${kind}"; use ${KINDS.slice(0, -1).join(", ")} or ${KINDS.at(-1)}.`,
      );
    else if (what === "")
      problems.push(`"${line}" has nothing after "${kind}:". Say what proves the criterion.`);
    else if (kind === "test") {
      const file = (what.split(/\s/)[0] ?? "").replace(/`/g, "");
      const path = resolve(root, file);
      if (!existsSync(path) || !statSync(path).isFile() || !inside(realpathSync(path)))
        problems.push(`"${line}" names the test file "${file}", which is not a file in the commit.`);
    }
  }
  for (const n of criteria) {
    const count = checks.get(n) ?? 0;
    if (count === 0)
      problems.push(`Criterion ${n} has no line in the verification contract. Add "- ${n}: <kind>:<what>".`);
    else if (count > 1)
      problems.push(`Criterion ${n} has ${count} lines in the verification contract; it needs exactly one.`);
  }
  return problems;
}

export async function planContractGate(g: GateJob) {
  const started = Date.now();
  const name = typeof g.settings.output === "string" ? g.settings.output : "plan";
  const planPath = (g.env[`FACTOR_OUTPUT_${name.toUpperCase()}`] ?? "").trim();
  const root = await g.checkouts.at(g.head, "head");
  const problems = planPath
    ? planProblems(root, planPath)
    : [`The lane handed off no output "${name}", so there is no plan to check.`];
  const text =
    problems.length > 0
      ? `The plan has ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n\n${problems.join("\n")}\n`
      : `The plan "${planPath}" gives each acceptance criterion one check.\n`;
  return record(g, problems.length === 0, text, started);
}
