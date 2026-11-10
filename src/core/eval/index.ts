// `softwarefactor eval`: run the seeded cases, print each with its result and the pass rate, and
// say when a check has stopped catching what it should. It starts no real agent and costs
// nothing (ADR 0010). `--break <gate>` makes one gate pass whatever it finds, in this process
// only: it is how the eval is shown to be able to fail.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { nowIso } from "../clock.ts";
import { UserError } from "../errors.ts";
import { GATES } from "../gates/index.ts";
import { oneLine } from "../text.ts";
import { CASES } from "./cases.ts";

type Say = (line: string) => void;
const Saved = z.object({
  softwarefactorEval: z.literal(1),
  at: z.string(),
  broken: z.string().optional(),
  cases: z.array(z.object({ id: z.string(), passed: z.boolean(), why: z.string().optional() })),
});

export async function evalCommand(
  flags: { break?: string; save?: string; compare?: string },
  say: Say,
): Promise<number> {
  let before: z.infer<typeof Saved> | undefined;
  if (flags.compare !== undefined) {
    if (!existsSync(flags.compare))
      throw new UserError(
        `There is no file ${flags.compare}.`,
        "Name a result that `softwarefactor eval --save` wrote.",
      );
    let read: unknown;
    try {
      read = JSON.parse(readFileSync(flags.compare, "utf8"));
    } catch {
      read = undefined; // not JSON, or not a file
    }
    const parsed = Saved.safeParse(read);
    if (!parsed.success)
      throw new UserError(
        `${flags.compare} is not a saved eval result.`,
        "Name a result that `softwarefactor eval --save` wrote.",
      );
    before = parsed.data;
  }
  if (flags.break !== undefined) {
    const gate = Object.hasOwn(GATES, flags.break) ? GATES[flags.break] : undefined;
    if (!gate)
      throw new UserError(
        `There is no gate "${oneLine(flags.break, 80)}" to break.`,
        `One of: ${Object.keys(GATES).join(", ")}.`,
      );
    // the gate still looks, and then says pass: what it should have caught is what the eval must now miss
    GATES[flags.break] = async (job) => ({ ...(await gate(job)), status: "pass" });
    say(`${flags.break} was broken on purpose for this eval: it passes whatever it finds.`);
  }
  const results: { id: string; passed: boolean; why?: string }[] = [];
  const wide = Math.max(...CASES.map((c) => c.id.length));
  for (const c of CASES) {
    let why: string | undefined;
    try {
      why = await c.run();
    } catch (error) {
      why = `the case could not run: ${oneLine((error as Error).message, 300)}`;
    }
    results.push({ id: c.id, passed: why === undefined, ...(why ? { why } : {}) });
    say(
      `${why === undefined ? "ok  " : "FAIL"}  ${c.id.padEnd(wide)}  ${why === undefined ? c.what : oneLine(why, 400)}`,
    );
  }
  const passed = results.filter((r) => r.passed).length;
  say(`${passed} of ${results.length} cases passed (${Math.floor((passed / results.length) * 100)}%)`);
  if (flags.save !== undefined) {
    const doc = {
      softwarefactorEval: 1,
      at: nowIso(),
      ...(flags.break ? { broken: flags.break } : {}),
      cases: results,
    };
    mkdirSync(dirname(resolve(flags.save)), { recursive: true });
    writeFileSync(flags.save, `${JSON.stringify(doc, null, 2)}\n`);
    say(`saved: ${flags.save}`);
  }
  let regressions = 0;
  if (before) {
    for (const r of results) {
      if (!r.passed && before.cases.find((c) => c.id === r.id)?.passed) {
        regressions += 1;
        say(`Regression: ${r.id} passed in ${flags.compare} and is not caught now`);
      }
    }
    // a case that was taken out catches nothing any more
    for (const c of before.cases) {
      if (!c.passed || results.some((r) => r.id === c.id)) continue;
      regressions += 1;
      say(`Regression: ${c.id} passed in ${flags.compare} and is not run now`);
    }
    if (regressions === 0) say(`Nothing is worse than in ${flags.compare} (${before.at.slice(0, 10)}).`);
  }
  if (flags.break !== undefined && passed === results.length) {
    say(
      `No case depends on ${flags.break}: with it broken, every case still passed. The eval does not show that this gate works.`,
    );
    return 1;
  }
  return passed === results.length && regressions === 0 ? 0 : 1;
}
