import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLane, bind, flowRepo, type Repo, standinAccount } from "../helpers/repo.ts";

const final = { actions: [{ final: { outcome: "pass", summary: "ok" } }] };
// the stand-in reports 2000 input tokens of which 500 were cached, and 300 output tokens
const codexRun = (model: string | undefined, before: (repo: Repo) => void = () => {}) => {
  const repo = flowRepo({ lanes: [agentLane("build")] });
  standinAccount(repo, "codex-a", "codex", final);
  bind(repo, "author", "codex-a", ...(model ? ["--medium", model] : []));
  before(repo);
  const run = repo.sf("run");
  if (run.status !== 0) throw new Error(run.stdout + run.stderr);
  return repo.rows<Record<string, unknown>>("select * from sessions")[0] ?? {};
};

describe("the session record of a lane worked by Codex", () => {
  it("counts cached input apart from input", () => {
    expect(codexRun("gpt-5.3-codex")).toMatchObject({
      agent: "codex",
      account: "codex-a",
      session_id: "codex-thread-1",
      input_tokens: 1500,
      cache_read_tokens: 500,
      output_tokens: 300,
      cache_write_tokens: 0,
      tokens: 2300,
    });
  });

  it("prices the tokens from the price table when the binding names the model", () => {
    const session = codexRun("gpt-5.3-codex");
    expect(session).toMatchObject({ model: "gpt-5.3-codex", usd_source: "priced" });
    // 1500 at 1.75, 500 at 0.175 and 300 at 14.00 dollars per million tokens
    expect(session.usd).toBeCloseTo(0.0069125, 9);
  });

  it("gives no cost, and says so, for a model that is not in the table or not named", () => {
    expect(codexRun("made-up-model")).toMatchObject({
      model: "made-up-model",
      usd: null,
      usd_source: "unknown",
    });
    expect(codexRun(undefined)).toMatchObject({ model: null, usd: null, usd_source: "unknown" });
  });

  it("takes a price from prices.json in the factor home", () => {
    const prices = { "made-up-model": { input: 1, cacheRead: 0.5, output: 2 } };
    const session = codexRun("made-up-model", (repo) =>
      writeFileSync(join(repo.home, "prices.json"), JSON.stringify(prices)),
    );
    expect(session.usd_source).toBe("priced");
    expect(session.usd).toBeCloseTo(0.00235, 9);
  });

  it("refuses a prices.json it cannot read, before any task is taken", () => {
    const repo = flowRepo({ lanes: [agentLane("build")] });
    standinAccount(repo, "codex-a", "codex", final);
    bind(repo, "author", "codex-a");
    writeFileSync(join(repo.home, "prices.json"), '{"m": {"input": "cheap"}}');
    const run = repo.sf("run");
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/prices\.json/);
    expect(repo.sf("status").stdout).not.toMatch(/running|stopped/);
  });
});
