import { linkSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jsonOf, startUi, type Ui } from "../helpers/repo.ts";
import { PIXEL, sql, threeRuns } from "../helpers/runs.ts";

interface Evidence {
  ref: string;
  ok: boolean;
  path?: string;
}
interface Detail {
  id: string;
  task: string;
  sentence: string;
  branch: string;
  lanes: {
    lane: string;
    outcome: string | null;
    note: string | null;
    tokens: number;
    gates: {
      gate: string;
      status: string;
      command: string | null;
      exitCode: number | null;
      output: string;
    }[];
    claims: { text: string; evidence: Evidence[] }[];
    sessions: {
      agent: string;
      tokens: number;
      usd: number | null;
      usdSource: string;
      transcript: string | null;
    }[];
    handoff: string | null;
  }[];
  inbox: { lane: string; kind: string; body: string }[];
  files: { path: string; name: string; size: number; visit: number }[];
}
const { repo, done, stopped, waiting } = threeRuns();
let ui: Ui;
beforeAll(async () => {
  ui = await startUi(repo);
}, 120_000);
afterAll(() => ui?.stop());
const detail = async (id: string) => (await jsonOf<{ run: Detail }>(await ui.api(`/api/runs/${id}`))).run;
const file = (id: string, path: string) => ui.api(`/api/runs/${id}/file?path=${encodeURIComponent(path)}`);
const folder = (id: string) => `.factor/runs/${id}`;

describe("one run", () => {
  it("is refused without the token: the run, a file and the diff", async () => {
    for (const path of [`/api/runs/${done}`, `/api/runs/${done}/file?path=x`, `/api/runs/${done}/diff`]) {
      expect((await fetch(`${ui.url}${path}`)).status, path).toBe(401);
    }
  });

  it("has each visit with its gates, claims and sessions", async () => {
    const run = await detail(done);
    expect(run).toMatchObject({ id: done, task: "First task", sentence: "Done." });
    expect(run.lanes.map((l) => `${l.lane}:${l.outcome}`)).toEqual(["build:pass", "check:pass", "ship:pass"]);
    const build = run.lanes[0];
    expect(build?.gates).toMatchObject([{ gate: "verify", status: "pass", command: "true", exitCode: 0 }]);
    expect(build?.gates[0]?.output.startsWith(`${folder(done)}/evidence/`)).toBe(true);
    expect(build?.claims.map((c) => c.text)).toEqual([
      "The feature file exists.",
      "The screen before and after.",
      "Notes were taken.",
    ]);
    expect(build?.claims[1]?.evidence.map((e) => e.ref)).toEqual([
      "attached:before.png",
      "attached:after.png",
    ]);
    expect(
      build?.claims[1]?.evidence.every((e) => e.ok && e.path?.startsWith(`${folder(done)}/evidence/`)),
    ).toBe(true);
    expect(build?.sessions).toMatchObject([{ agent: "fake", tokens: 1200, usd: 0.25 }]);
    expect(build?.handoff?.startsWith(`${folder(done)}/handoffs/`)).toBe(true);
    expect(build?.tokens).toBe(1200);
  });

  it("lists the run's files with the names its claims gave them", async () => {
    const { files, lanes } = await detail(done);
    const named = Object.fromEntries(files.map((f) => [f.name, f]));
    expect(Object.keys(named)).toEqual(expect.arrayContaining(["before.png", "after.png", "notes.txt"]));
    expect(named["before.png"]?.path).toBe(lanes[0]?.claims[1]?.evidence[0]?.path);
    expect(named["before.png"]?.size).toBe(Buffer.from(PIXEL, "base64").length);
    // a gate's output has no name from a claim: its file name
    expect(files.some((f) => /verify.*\.log$/.test(f.name))).toBe(true);
    expect(new Set(files.map((f) => f.path)).size).toBe(files.length);
    // files of one visit share its number
    expect(named["before.png"]?.visit).toBe(named["after.png"]?.visit);
  });

  it("shows what waits for a person, and where a stopped run stopped", async () => {
    const waits = await detail(waiting);
    expect(waits.inbox).toMatchObject([{ lane: "ship", kind: "approval" }]);
    const halted = await detail(stopped);
    expect(halted.lanes.at(-1)).toMatchObject({ lane: "check", outcome: "fail" });
    expect(halted.inbox).toEqual([]);
  });

  it("serves a file of the run as what it is", async () => {
    const { files, lanes } = await detail(done);
    const shot = await file(done, files.find((f) => f.name === "before.png")?.path ?? "");
    expect(shot.status).toBe(200);
    expect(shot.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await shot.arrayBuffer()).toString("base64")).toBe(PIXEL);
    const log = await file(done, lanes[0]?.gates[0]?.output ?? "");
    expect(log.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await log.text()).toMatch(/^\$ true\n# gate verify/);
    const handoff = await file(done, lanes[0]?.handoff ?? "");
    expect(handoff.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await handoff.text()).toContain("Added the feature file.");
  });

  it("never serves a page: html and svg come as plain text, the unknown as a download", async () => {
    const dir = join(repo.dir, folder(done), "evidence");
    writeFileSync(join(dir, "page.html"), "<script>top.x = 1</script>");
    writeFileSync(join(dir, "drawing.svg"), '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>');
    writeFileSync(join(dir, "thing.bin"), "\u0000\u0001");
    writeFileSync(join(dir, "clip.webm"), "not really a video");
    for (const name of ["page.html", "drawing.svg"]) {
      const answer = await file(done, `${folder(done)}/evidence/${name}`);
      expect(answer.status, name).toBe(200);
      expect(answer.headers.get("content-type"), name).toMatch(/^text\/plain/);
      expect(answer.headers.get("x-content-type-options")).toBe("nosniff");
    }
    const bin = await file(done, `${folder(done)}/evidence/thing.bin`);
    expect(bin.headers.get("content-type")).toBe("application/octet-stream");
    expect(bin.headers.get("content-disposition")).toMatch(/^attachment/);
    expect((await file(done, `${folder(done)}/evidence/clip.webm`)).headers.get("content-type")).toBe(
      "video/webm",
    );
  });

  it("serves nothing outside the run's own folder", async () => {
    const other = (await detail(stopped)).lanes[0]?.gates[0]?.output ?? "";
    const outside = [
      `${folder(done)}/evidence/../../../factory.json`,
      `${folder(done)}/../../factory.json`,
      ".factor/factory.json",
      "/etc/hosts",
      "../../../../etc/hosts",
      other, // another run's file, by its recorded path
      `${folder(done)}/evidence`, // a folder
      `${folder(done)}/evidence/missing.log`,
      "",
    ];
    for (const path of outside) {
      const answer = await file(done, path);
      expect(answer.status, path).toBe(404);
      expect(await jsonOf(answer), path).toEqual({ error: "There is no such file in this run." });
    }
    // and the other run's file is there, under its own run
    expect((await file(stopped, other)).status).toBe(200);
    // doubly encoded dots are a file name, not a way up
    expect(
      (await ui.api(`/api/runs/${done}/file?path=${folder(done)}/evidence/%252e%252e/%252e%252e/local.json`))
        .status,
    ).toBe(404);
    expect((await ui.api(`/api/runs/${done}/file`)).status).toBe(404);
  });

  it("does not follow a link, in the file or on the way to it", async () => {
    const dir = join(repo.dir, folder(done), "evidence");
    symlinkSync(join(repo.dir, ".factor/local.json"), join(dir, "linked.txt"));
    linkSync(join(repo.dir, ".factor/local.json"), join(dir, "hard.txt"));
    mkdirSync(join(repo.home, "elsewhere"));
    writeFileSync(join(repo.home, "elsewhere/secret.txt"), "secret");
    symlinkSync(join(repo.home, "elsewhere"), join(dir, "sub"));
    for (const name of ["linked.txt", "hard.txt", "sub/secret.txt"]) {
      expect((await file(done, `${folder(done)}/evidence/${name}`)).status, name).toBe(404);
    }
    // they are not listed either
    const names = (await detail(done)).files.map((f) => f.name);
    expect(names).not.toContain("linked.txt");
    expect(names).not.toContain("hard.txt");
    // the whole evidence folder swapped for a link
    const real = join(repo.dir, folder(stopped), "evidence");
    renameSync(real, `${real}.real`);
    symlinkSync(join(repo.home, "elsewhere"), real);
    expect((await file(stopped, `${folder(stopped)}/evidence/secret.txt`)).status).toBe(404);
    expect((await ui.api(`/api/runs/${stopped}`)).status).toBe(200);
  });

  it("does not trust a path because the record holds it", async () => {
    sql(repo, (db) =>
      db.exec(`update gate_results set output_path = '../../README.md' where run_id = '${waiting}'`),
    );
    const run = await detail(waiting);
    expect(run.lanes[0]?.gates[0]?.output).toBe("../../README.md");
    expect((await file(waiting, "../../README.md")).status).toBe(404);
    expect((await file(waiting, "README.md")).status).toBe(404);
  });

  it("answers 404 for a run that is not in the record", async () => {
    mkdirSync(join(repo.dir, ".factor/runs/ghost/evidence"), { recursive: true });
    writeFileSync(join(repo.dir, ".factor/runs/ghost/evidence/a.log"), "x");
    for (const id of ["ghost", "..", "%2e%2e", "nope", `${done}x`]) {
      expect((await ui.api(`/api/runs/${id}`)).status, id).toBe(404);
      expect((await ui.api(`/api/runs/${id}/file?path=.factor/runs/ghost/evidence/a.log`)).status, id).toBe(
        404,
      );
      expect((await ui.api(`/api/runs/${id}/diff`)).status, id).toBe(404);
    }
  });

  it("gives the run's diff as text", async () => {
    const answer = await ui.api(`/api/runs/${done}/diff`);
    expect(answer.status).toBe(200);
    const { diff, cut } = await jsonOf<{ diff: string; cut: boolean }>(answer);
    expect(diff).toContain("+++ b/src/feature.txt");
    expect(diff).toContain("+one");
    expect(cut).toBe(false);
    expect(readFileSync(join(repo.dir, "README.md"), "utf8")).toContain("fixture"); // nothing was checked out
  });

  it("says why when there is no diff to give, and does not break", async () => {
    sql(repo, (db) => {
      db.exec(`update runs set head_commit = null where id = '${stopped}'`);
      db.exec(
        `update runs set head_commit = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' where id = '${waiting}'`,
      );
    });
    for (const id of [stopped, waiting]) {
      const answer = await ui.api(`/api/runs/${id}/diff`);
      expect(answer.status, id).toBe(200);
      const body = await jsonOf<{ diff: string; note?: string }>(answer);
      expect(body.diff, id).toBe("");
      expect(body.note, id).toBeTruthy();
    }
    // a commit name that is not one is never handed to git as an option
    sql(repo, (db) =>
      db.exec(
        `update runs set head_commit = '--output=${join(repo.home, "written")}' where id = '${waiting}'`,
      ),
    );
    const odd = await jsonOf<{ diff: string; note?: string }>(await ui.api(`/api/runs/${waiting}/diff`));
    expect(odd.diff).toBe("");
    expect(() => readFileSync(join(repo.home, "written"))).toThrow();
  });
});
