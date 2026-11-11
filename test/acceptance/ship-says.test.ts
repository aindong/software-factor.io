// A run that ends done says what its last lane did: a command lane's last printed line is its
// sentence, as an agent lane's summary is, and the run's own sentence carries it. A person who
// approved the ship can read what happened without opening a log.
import { expect, it } from "vitest";
import { sentenceOf } from "../../src/core/runs/sentence.ts";
import { commandLane, flowRepo, makeRepo, type Repo } from "../helpers/repo.ts";

const done = (repo: Repo) => {
  const run = repo.sf("run");
  expect(run.status, run.stdout + run.stderr).toBe(0);
  return repo.rows<{ id: string }>("select id from runs")[0]?.id ?? "";
};

it("keeps the last line a command lane printed as that lane's sentence, and the run says it", () => {
  const repo = flowRepo({
    lanes: [commandLane("ship", 'echo "pushing"; echo; echo "https://example.invalid/pull/7"; echo')],
  });
  const id = done(repo);
  expect(repo.sf("runs", id).stdout).toMatch(/ship\s+pass\s+https:\/\/example\.invalid\/pull\/7/);
  expect(repo.sf("runs").stdout).toMatch(/Done\. .*https:\/\/example\.invalid\/pull\/7$/m);
}, 120_000);

it("says only Done when the last lane printed nothing", () => {
  const repo = flowRepo({ lanes: [commandLane("ship", "true")] });
  done(repo);
  expect(repo.sf("runs").stdout).toMatch(/^\s+Done\.$/m);
}, 120_000);

it("tells a command lane the key of its task", () => {
  const repo = flowRepo({ lanes: [commandLane("ship", 'echo "key=$FACTOR_TASK_KEY"')] });
  const id = done(repo);
  const key = repo.rows<{ key: string }>("select key from tasks")[0]?.key ?? "";
  expect(key).not.toBe("");
  expect(repo.sf("runs", id).stdout).toContain(`key=${key}`);
}, 120_000);

it("writes the done sentence from the last lane's name and words, cut when they are long", () => {
  expect(sentenceOf({ status: "done" })).toBe("Done.");
  expect(sentenceOf({ status: "done", last: { lane: "Ship", said: "https://example.invalid/pull/7" } })).toBe(
    "Done. Ship: https://example.invalid/pull/7",
  );
  const long = sentenceOf({ status: "done", last: { lane: "Ship", said: "word ".repeat(200) } });
  expect(long.length).toBeLessThan(300);
});

it("has the starter's ship say what it merged, and that nothing was pushed", () => {
  const repo = makeRepo();
  expect(repo.sf("init").status).toBe(0);
  const ship = repo.json<{ commands: { ship: string } }>(".factor/factory.json").commands.ship;
  expect(ship).toMatch(/Merged .* Nothing was pushed\./);
});
