import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { background, commandLane, flowRepo, type Repo, until } from "../helpers/repo.ts";

const stamp = `$(${process.execPath} -e 'process.stdout.write(String(Date.now()))')`;
const work = `echo "start $FACTOR_SLOT $FACTOR_PORT $FACTOR_DB_NAME $FACTOR_BROWSER_SESSION ${stamp}" >> "$LOG"; sleep 1; echo "end $FACTOR_SLOT ${stamp}" >> "$LOG"`;
const flow = (tasks: string[], slots?: Record<string, unknown>) => {
  const repo = flowRepo({
    tasks: tasks.map((t) => `- [ ] ${t}\n`).join(""),
    gates: {
      slot: {
        uses: "core/command@1",
        with: { run: 'test -n "$FACTOR_SLOT" && test -n "$FACTOR_PORT"' },
        onFail: "fail",
      },
    },
    lanes: [commandLane("work", work, { gates: ["slot"] })],
    factory: { gateEnv: ["LOG"], ...(slots ? { slots } : {}) },
  });
  repo.env.LOG = join(repo.home, "log.txt");
  return repo;
};
const events = (repo: Repo) =>
  readFileSync(repo.env.LOG ?? "", "utf8")
    .trim()
    .split("\n")
    .map((l) => l.split(" "));
/** The most runs that were working at one moment. */
function peak(repo: Repo): number {
  const marks = events(repo)
    .map((e) => ({ at: Number(e.at(-1)), d: e[0] === "start" ? 1 : -1 }))
    .sort((a, b) => a.at - b.at || a.d - b.d);
  let now = 0;
  let most = 0;
  for (const m of marks) {
    now += m.d;
    most = Math.max(most, now);
  }
  return most;
}
const statuses = (repo: Repo) =>
  repo.rows<{ status: string }>("select status from runs").map((r) => r.status);

describe("runs side by side", () => {
  it("work at the same moment, each in its own slot", () => {
    const repo = flow(["A", "B"]);
    const r = repo.sf("run", "--all");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(statuses(repo)).toEqual(["done", "done"]);
    const starts = events(repo).filter((e) => e[0] === "start");
    expect(peak(repo)).toBe(2);
    for (const column of [1, 2, 3, 4])
      expect(new Set(starts.map((e) => e[column])).size, `column ${column}`).toBe(2);
    expect(starts.map((e) => e[3]).every((db) => /_factor_\d+$/.test(db ?? ""))).toBe(true);
    expect(repo.rows("select run_id from slots")).toEqual([]);
  });

  it("never exceed the number of slots", () => {
    const repo = flow(["A", "B", "C"]);
    expect(repo.sf("run", "--all").status).toBe(0);
    expect(statuses(repo)).toEqual(["done", "done", "done"]);
    expect(peak(repo)).toBe(2);
  });

  it("can be capped lower for one call", () => {
    const repo = flow(["A", "B"]);
    expect(repo.sf("run", "--all", "--parallel", "1").status).toBe(0);
    expect(peak(repo)).toBe(1);
  });

  it("leave a task queued when every slot is busy", async () => {
    const repo = flow(["A", "B"], { max: 1 });
    const first = background(repo, "run");
    expect(await until(() => repo.rows("select run_id from slots").length === 1)).toBe(true);
    const second = repo.sf("run");
    expect(second.stdout).toMatch(/slot/i);
    expect(repo.rows("select status from tasks order by id")).toEqual([
      { status: "running" },
      { status: "queued" },
    ]);
    await first.exit;
    expect(repo.rows("select run_id from slots")).toEqual([]);
  }, 20_000);

  it("give the slot back while a run waits for a person", () => {
    const repo = flowRepo({ lanes: [commandLane("ship", "true", { checkpoint: "in" })] });
    expect(repo.sf("run").status).toBe(3);
    expect(repo.rows("select run_id from slots")).toEqual([]);
  });
});
