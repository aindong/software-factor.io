// What each login's CLI says of its limits, read with a stand-in CLI: in what the page reads
// (`accounts_list`) and in `softwarefactor account list`, with the time of the reading, beside the
// factory's own count, and without a model call or a look at a login's files.
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { op } from "../helpers/operator.ts";
import { agentLane, flowRepo, standinAccount, startUi, type Ui } from "../helpers/repo.ts";

interface Window {
  name: string;
  percent: number | null;
  resets: string | null;
}
interface Reading {
  at: string;
  windows: Window[];
  failed: string | null;
  none: string | null;
}
interface Accounts {
  accounts: {
    name: string;
    agent: string;
    limits: { hours: number; tokens: number; used: number }[];
    reading: Reading | null;
  }[];
}

const repo = flowRepo({ lanes: [agentLane("build")] });

/** A login whose CLI is a shell script: it prints out.txt and err.txt beside it, and ends with `code`. */
function claudeLogin(name: string, out: string, err: string, code: number, extra: string[] = []) {
  const dir = join(repo.home, "profiles", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "out.txt"), out);
  writeFileSync(join(dir, "err.txt"), err);
  const bin = join(dir, "claude");
  writeFileSync(
    bin,
    `#!/bin/sh\nhere=$(dirname "$0")\necho "$*" >> "$here/args.txt"\ncat "$here/out.txt"\ncat "$here/err.txt" >&2\nexit ${code}\n`,
  );
  chmodSync(bin, 0o755);
  const r = repo.sf("account", "add", name, "--agent", "claude", "--profile", dir, "--bin", bin, ...extra);
  if (r.status !== 0) throw new Error(`account add failed: ${r.stdout}${r.stderr}`);
  return {
    dir,
    calls: () =>
      existsSync(join(dir, "args.txt")) ? readFileSync(join(dir, "args.txt"), "utf8").trim().split("\n") : [],
  };
}

const work = claudeLogin(
  "work",
  [
    "Usage",
    "Current week (all models): 73% used · resets Nov 15 at 6:59am (Asia/Manila)",
    "Current week (Fable): 92% used · resets Nov 15 at 7am (Asia/Manila)",
    "Extra usage: off",
  ].join("\n"),
  "",
  0,
  ["--limit", "5h=1000"],
);
const broken = claudeLogin("broken", "", "Not logged in · Please run /login\n", 1);
const codex = standinAccount(repo, "other", "codex", {});
// a login's own files: the factory never reads them, so nothing of them can show
writeFileSync(join(work.dir, ".credentials.json"), '{"token":"MARKER-LIMITS-1"}');
writeFileSync(join(codex.dir, "auth.json"), '{"token":"MARKER-LIMITS-2"}');
appendFileSync(
  join(repo.home, "usage.jsonl"),
  `${JSON.stringify({ at: Date.now() - 60_000, account: "work", tokens: 400 })}\n`,
);

let ui: Ui;
beforeAll(async () => {
  ui = await startUi(repo);
}, 120_000);
afterAll(() => ui?.stop());
const list = async (input: unknown = {}) => {
  const answer = await op<Accounts>(ui, "accounts_list", input);
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return answer.body.accounts;
};
const of = (accounts: Accounts["accounts"], name: string) => {
  const found = accounts.find((a) => a.name === name);
  if (!found) throw new Error(`no account ${name}`);
  return found;
};

describe("a login's limits as its CLI reports them", () => {
  let first = "";

  it("are read when asked, with the time of the reading, and a window not printed is not reported", async () => {
    const before = Date.now();
    const accounts = await list({ read: true });
    const reading = of(accounts, "work").reading;
    expect(reading).not.toBeNull();
    first = reading?.at ?? "";
    expect(Date.parse(first)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(first)).toBeLessThanOrEqual(Date.now() + 1000);
    expect(reading?.failed).toBeNull();
    expect(reading?.windows).toEqual(
      expect.arrayContaining([
        { name: "Current week (all models)", percent: 73, resets: "Nov 15 at 6:59am (Asia/Manila)" },
        { name: "Current week (Fable)", percent: 92, resets: "Nov 15 at 7am (Asia/Manila)" },
        { name: "Current session", percent: null, resets: null },
      ]),
    );
    expect(reading?.windows.map((w) => w.name).join(" ")).not.toMatch(/Extra usage|^Usage/);
    // one start of the CLI, for the usage page alone
    expect(work.calls()).toEqual(["-p /usage"]);
  });

  it("keep the factory's own count beside them, as it was", async () => {
    const accounts = await list();
    expect(of(accounts, "work").limits).toEqual([{ hours: 5, tokens: 1000, used: 400 }]);
  });

  it("say why a reading failed, and the other logins still show theirs", async () => {
    const accounts = await list();
    expect(of(accounts, "broken").reading?.failed).toMatch(/Not logged in/);
    expect(of(accounts, "broken").reading?.windows).toEqual([]);
    expect(of(accounts, "work").reading?.windows.length).toBeGreaterThan(0);
    // the failure is said in the CLI's words, not with where the login is kept
    expect(of(accounts, "broken").reading?.failed).not.toContain(repo.home);
  });

  it("say in plain words that Codex reports nothing without a model call, and never start it for that", async () => {
    const reading = of(await list(), "other").reading;
    expect(reading?.windows).toEqual([]);
    expect(reading?.failed).toBeNull();
    expect(reading?.none).toMatch(/Codex/);
    expect(reading?.none).toMatch(/model call/);
    expect(codex.calls()).toEqual([]);
  });

  it("are kept with their time: reading the page again does not start the CLI", async () => {
    const accounts = await list();
    expect(of(accounts, "work").reading?.at).toBe(first);
    expect(work.calls()).toHaveLength(1);
  });

  it("show nothing of a login's own files", async () => {
    const text = JSON.stringify(await list());
    expect(text).not.toMatch(/MARKER-LIMITS/);
    expect(text).not.toContain(repo.home);
  });

  it("are printed the same by `softwarefactor account list`, with the time of the reading", async () => {
    const r = repo.sf("account", "list");
    expect(r.status, r.stderr).toBe(0);
    const out = r.stdout;
    expect(out).toContain("Current week (all models): 73% used · resets Nov 15 at 6:59am (Asia/Manila)");
    expect(out).toContain("Current week (Fable): 92% used · resets Nov 15 at 7am (Asia/Manila)");
    expect(out).toMatch(/Current session: not reported/);
    expect(out).not.toMatch(/Current session: 0%/);
    expect(out).toMatch(/read at \d{4}-\d\d-\d\dT\d\d:\d\d/);
    expect(out).toMatch(/Not logged in/);
    expect(out).toMatch(/Codex[^\n]*model call/);
    // the factory's own count, named so it is not taken for the CLI's
    expect(out).toMatch(/factory[^\n]*400 of 1,?000 tokens in 5 ?h/);
    expect(out).not.toMatch(/MARKER-LIMITS/);
    // the command line took a reading of its own, and the page reads it next
    expect(work.calls()).toHaveLength(2);
    expect(broken.calls()).toHaveLength(2);
    expect(codex.calls()).toEqual([]);
    const kept = of(await list(), "work").reading?.at ?? "";
    expect(Date.parse(kept)).toBeGreaterThanOrEqual(Date.parse(first));
    expect(out).toContain(`read at ${kept}`);
  });
});
