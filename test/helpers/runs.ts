// A workspace with three runs for the interface's tests: one done, one stopped, one that waits.
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { agentLane, commandLane, commitFile, flowRepo, type Repo } from "./repo.ts";

/** A 1 by 1 PNG, as base64. */
export const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// passes on every start but the second: the second task's run stops here
const check =
  'n=$(cat "$COUNT" 2>/dev/null || echo 0); echo $((n + 1)) > "$COUNT"; echo "checked $n"; [ "$n" -ne 1 ]';

export interface ThreeRuns {
  repo: Repo;
  /** The run ids: done, stopped, waiting. */
  done: string;
  stopped: string;
  waiting: string;
}

export function threeRuns(): ThreeRuns {
  const repo = flowRepo({
    tasks: "- [ ] First task\n- [ ] Second task\n- [ ] Third task\n",
    lanes: [
      agentLane("build", {
        name: "Build",
        agent: { access: "write" },
        gates: ["verify"],
        on: { pass: "check", fail: "@stop" },
      }),
      commandLane("check", check, { on: { pass: "ship", fail: "@stop" } }),
      commandLane("ship", "true", { name: "Ship it", checkpoint: "in" }),
    ],
    scripts: {
      author: {
        build: [
          ...commitFile("src/feature.txt", "one\ntwo\n"),
          { attach: { name: "before.png", content: PIXEL, base64: true } },
          { attach: { name: "after.png", content: PIXEL, base64: true } },
          { attach: { name: "notes.txt", content: "what was checked\n" } },
          { usage: { tokens: 1200, usd: 0.25 } },
          {
            handoff: {
              outcome: "pass",
              summary: "Added the feature file.",
              claims: [
                { text: "The feature file exists.", evidence: ["file:src/feature.txt", "commit:HEAD"] },
                {
                  text: "The screen before and after.",
                  evidence: ["attached:before.png", "attached:after.png"],
                },
                { text: "Notes were taken.", evidence: ["attached:notes.txt"] },
              ],
            },
          },
        ],
      },
    },
    factory: { gateEnv: ["COUNT"] },
  });
  repo.env.COUNT = join(repo.home, "count.txt");
  const ids = () =>
    repo.rows<{ id: string }>("select id from runs order by started_at, rowid").map((r) => r.id);
  const must = (what: string, status: number | null, wanted: number) => {
    if (status !== wanted) throw new Error(`${what}: exit ${status}, wanted ${wanted}`);
  };
  const first = repo.sf("run");
  if (first.status !== 3) throw new Error(`first run: exit ${first.status}: ${first.stdout}${first.stderr}`);
  must("approve", repo.sf("approve", ids()[0] ?? "").status, 0);
  must("second run", repo.sf("run").status, 1); // check fails
  must("third run", repo.sf("run").status, 3); // waits at ship
  const [done = "", stopped = "", waiting = ""] = ids();
  return { repo, done, stopped, waiting };
}

/** Change the record by hand, for a state no command of the factory leaves behind. */
export function sql(repo: Repo, work: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(join(repo.dir, ".factor/state.db"));
  try {
    work(db);
  } finally {
    db.close();
  }
}
