// In a workspace with no `.factor/state.db`, `cost` and `cost --check` say there is nothing yet and leave no database.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, flowRepo, makeRepo, type Repo } from "../helpers/repo.ts";
import { sql } from "../helpers/runs.ts";

const files = (repo: Repo) => readdirSync(join(repo.dir, ".factor")).sort();
const database = (repo: Repo) => files(repo).filter((f) => f.startsWith("state.db"));
const hasDatabase = (repo: Repo) => existsSync(join(repo.dir, ".factor", "state.db"));
const fresh = () => flowRepo({ lanes: [agentLane("build")] });

describe("a workspace with no record", () => {
  it("starts without a database, so the tests below prove something", () => {
    expect(database(fresh())).toEqual([]);
  });

  it("`cost` says no sessions yet, exits 0 and creates no database, however often it runs", () => {
    const repo = fresh();
    const before = files(repo);
    for (let i = 0; i < 2; i++) {
      const r = repo.sf("cost");
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.stderr).toBe("");
      expect(r.stdout).toMatch(/^No sessions yet/);
    }
    expect(database(repo)).toEqual([]);
    expect(files(repo)).toEqual(before);
    expect(repo.git("status", "--porcelain")).toBe("");
  });

  it("`cost --check` says no sessions yet, exits 0 and creates no database", () => {
    const repo = fresh();
    const r = repo.sf("cost", "--check");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toMatch(/^No sessions yet/);
    expect(database(repo)).toEqual([]);
  });

  it("`cost --json` prints the empty report and creates no database", () => {
    const repo = fresh();
    const r = repo.sf("cost", "--json");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).total.sessions).toBe(0);
    expect(database(repo)).toEqual([]);
  });

  it("is still refused outside a factory, as before", () => {
    const r = makeRepo().sf("cost");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no factory yet/i);
  });
});

describe("a workspace that has a record", () => {
  it("reports its sessions as before, and keeps its database", () => {
    const repo = fresh();
    expect(repo.sf("run").status).toBe(0);
    expect(hasDatabase(repo)).toBe(true);
    const r = repo.sf("cost");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^By task/);
    expect(repo.sf("cost", "--check").stdout).toMatch(/^Checked 1 session/);
    expect(hasDatabase(repo)).toBe(true);
  });

  it("with a database that holds no session still says no sessions yet", () => {
    const repo = fresh();
    repo.sf("run");
    sql(repo, (db) => db.exec("delete from sessions"));
    expect(repo.sf("cost").stdout).toMatch(/^No sessions yet/);
    expect(repo.sf("cost", "--check").stdout).toMatch(/^No sessions yet/);
    expect(hasDatabase(repo)).toBe(true);
  });
});

it("docs/costs.md says `cost` creates no database in a workspace with no record", () => {
  const doc = readFileSync("docs/costs.md", "utf8");
  expect(doc).toMatch(/no record/i);
  expect(doc).toMatch(/creates? no `?\.factor\/state\.db`?|does not create `?\.factor\/state\.db`?/i);
});
