// Helpers for the ladder tests: a workspace whose one agent lane waits for a person, runs that are
// approved as they are, and the ladder as the command prints it.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { agentLane, commandLane, commitFile, flowRepo, pass, type Repo } from "./repo.ts";

type Json = Record<string, unknown>;

/** A workspace with a `build` lane at `in` (and what `extra` adds to it), a `ship` command lane, and a suggestion after `runs` clean runs. */
export function ladderRepo(extra: Json = {}, runs = 2): Repo {
  const repo = flowRepo({
    lanes: [
      agentLane("build", {
        agent: { access: "write" },
        gates: ["verify"],
        checkpoint: "in",
        on: { pass: "ship", fail: "@stop" },
        ...extra,
      }),
      commandLane("ship", "true"),
    ],
    // every run starts from the same commit, so the same file is a change in each
    scripts: {
      author: { build: [{ write: { path: "work.txt", content: "work\n" } }, { commit: "work" }, pass()] },
    },
    tasks: Array.from({ length: 12 }, (_, i) => `- [ ] Task ${i + 1}\n`).join(""),
    factory: { ladder: { runs } },
  });
  return repo;
}

export const lastRun = (repo: Repo) =>
  repo.rows<{ id: string; status: string }>(
    "select id, status from runs order by started_at desc, rowid desc limit 1",
  )[0] ?? {
    id: "",
    status: "none",
  };

/** One run from start to done: started, and approved as it is wherever it waits. Returns its id. */
export function cleanRun(repo: Repo): string {
  repo.sf("run");
  for (let i = 0; i < 4 && lastRun(repo).status === "waiting"; i += 1) repo.sf("approve", lastRun(repo).id);
  const run = lastRun(repo);
  if (run.status !== "done") throw new Error(`the run ended ${run.status}`);
  return run.id;
}

export const checkpointOf = (repo: Repo, lane = "build") =>
  repo
    .json<{ lanes: { id: string; checkpoint: string }[] }>(".factor/workflows/starter.json")
    .lanes.find((l) => l.id === lane)?.checkpoint;

/** The ladder's line for a lane, as `softwarefactor ladder` prints it. */
export const ladderLine = (repo: Repo, lane = "build") =>
  repo
    .sf("ladder")
    .stdout.split("\n")
    .find((l) => l.trim().startsWith(`${lane} `)) ?? "";

/** Every prompt the latest run gave to a lane, as one text. */
export function latestPrompts(repo: Repo, lane: string): string {
  const dir = join(repo.dir, ".factor/runs", lastRun(repo).id, "prompts");
  return readdirSync(dir)
    .filter((f) => f.includes(`-${lane}`))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
}
