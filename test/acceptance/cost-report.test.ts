// `softwarefactor cost`: by task, by lane with the four kinds of tokens, by account and by model.
import { expect, it } from "vitest";
import { ledger, section } from "../helpers/cost.ts";

it("prints four sections, and each lane's kinds are the sums of its session rows", () => {
  const book = ledger();
  const a = book.run(book.task("Alpha", "done"), "run-a", "done");
  // every kind is its own number, so that two kinds printed in each other's place are seen
  book.session(a, { input: 11, output: 7, cacheRead: 5, cacheWrite: 3, usd: 0.01 });
  book.session(a, {
    lane: "check",
    account: "spare",
    agent: "codex",
    model: "gpt-6.1-sol",
    input: 13,
    output: 17,
    cacheRead: 19,
    cacheWrite: 23,
    usd: 0.02,
  });
  const b = book.run(book.task("Beta", "stopped"), "run-b", "stopped", "gate_stop");
  book.session(b, { input: 101, output: 103, cacheRead: 107, cacheWrite: 109, usd: null });
  // a session whose run is no longer in the record still counts
  book.session("run-gone", { model: null, input: 1, output: 2, cacheRead: 3, cacheWrite: 4, usd: 0.5 });

  const printed = book.repo.sf("cost");
  expect(printed.status, printed.stderr).toBe(0);
  const out = `\n${printed.stdout}`; // a heading is looked for at the start of a line, the first one too
  const order = ["By task", "By lane", "By account", "By model"].map((h) => out.indexOf(`\n${h}`));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect([...order].sort((x, y) => x - y)).toEqual(order);

  const sums = book.repo.rows<Record<string, number | string>>(
    "select lane, count(*) as n, sum(input_tokens) as i, sum(output_tokens) as o, sum(cache_read_tokens) as r, sum(cache_write_tokens) as w, sum(tokens) as t from sessions group by lane",
  );
  expect(sums).toHaveLength(2);
  const lanes = section(out, "By lane");
  for (const s of sums) {
    const line = lanes.find((l) => l.trim().startsWith(`${s.lane} `));
    expect(line, String(s.lane)).toBeDefined();
    expect(line?.trim().split(/\s+/).slice(0, 7)).toEqual([s.lane, s.n, s.i, s.o, s.r, s.w, s.t].map(String));
  }
  expect(lanes.find((l) => l.trim().startsWith("build "))).toMatch(/\$0\.51\b.*1 of unknown cost/);

  expect(section(out, "By task").join("\n")).toMatch(
    /Alpha[\s\S]*Beta.*unknown[\s\S]*a task that is no longer in/,
  );
  expect(section(out, "By account").map((l) => l.trim().split(/\s+/)[0])).toEqual(["work", "spare"]);
  const models = section(out, "By model").join("\n");
  expect(models).toMatch(/^\s+claude-sonnet-5-5\s+2 sessions\s+446 tokens/m);
  expect(models).toMatch(/^\s+gpt-6\.1-sol\s+1 session\s+72 tokens\s+\$0\.02/m);
  expect(models).toMatch(/^\s+\(no model named\)\s+1 session\s+10 tokens\s+\$0\.50/m);
  expect(out).toMatch(/^Total\s+4 sessions\s+528 tokens\s+\$0\.53/m);
});
