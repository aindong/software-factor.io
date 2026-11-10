// Helpers for the export and import tests.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentLane, commandLane, commitFile, flowRepo, makeRepo, pass, type Repo } from "./repo.ts";

type Json = Record<string, unknown>;
export interface Export {
  softwarefactorExport: number;
  workflow: Json & { name: string; lanes: (Json & { id: string; checkpoint?: string; pin?: boolean })[] };
  plugins?: Record<string, { version: string; source: string; sha256: string; commit?: string }>;
}

/** A workspace to export from: an agent lane that writes (its prompt in a file), then a command lane, with a gate. */
export function source(): Repo {
  const repo = flowRepo({
    lanes: [
      agentLane("build", {
        agent: { access: "write", prompt: { file: "prompts/build.md" } },
        gates: ["verify"],
        on: { pass: "ship", fail: "@stop" },
      }),
      commandLane("ship", "echo shipped", { pin: true }),
    ],
    scripts: { author: { build: [...commitFile("notes.txt"), pass()] } },
    commands: { verify: "echo THE-VERIFY-LINE-OF-THIS-REPO" },
  });
  mkdirSync(join(repo.dir, ".factor/workflows/prompts"), { recursive: true });
  repo.write(".factor/workflows/prompts/build.md", "Build what the task asks for.\nKeep it small.\n");
  return repo;
}

/** The export a workspace prints, parsed. */
export function exported(
  repo: Repo,
  ...args: string[]
): { doc: Export; text: string; stderr: string; status: number | null } {
  const r = repo.sf("export", ...args);
  let doc = {} as Export;
  try {
    doc = JSON.parse(r.stdout);
  } catch {
    // it printed something that is no JSON: the test will say so
  }
  return { doc, text: r.stdout, stderr: r.stderr, status: r.status };
}

/** A clean folder with a factory in it and nothing else, and the export saved beside it. Returns the export's path. */
export function clean(text: string): { repo: Repo; file: string } {
  const repo = makeRepo();
  if (repo.sf("init").status !== 0) throw new Error("init failed");
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "a factory");
  const file = join(repo.home, "shared.json");
  writeFileSync(file, text);
  return { repo, file };
}
