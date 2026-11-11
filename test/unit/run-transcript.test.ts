// What an agent did, read from the lines its CLI printed: Claude Code's and Codex's shapes, and
// whatever else turns up. Every line here is written by hand.
import { describe, expect, it } from "vitest";
import { account, memberOf } from "../../src/core/runs/transcript.ts";

const j = (...events: unknown[]) => events.map((e) => JSON.stringify(e)).join("\n");
const use = (id: string, name: string, input: unknown) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name, input }] },
});
const back = (id: string, content: unknown, is_error?: boolean) => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error }] },
});

const claude = j(
  { type: "system", subtype: "hook_started", hook_id: "h1", session_id: "s" },
  { type: "system", subtype: "init", cwd: "/work", tools: ["Bash"] },
  { type: "assistant", message: { content: [{ type: "text", text: "Reading the plan first." }] } },
  use("t1", "Bash", { command: "ls src\ncat a" }),
  back("t1", "a\nb\nc\nd\ne"),
  use("t2", "Read", { file_path: "/w/x.ts" }),
  back("t2", [{ type: "text", text: "nope" }], true),
  { type: "assistant", message: { content: [{ type: "thinking", thinking: "" }] } },
  { type: "rate_limit_event", rate_limit_info: {} },
  { type: "tool_progress", tool_use_id: "t1", elapsed_time_seconds: 30 },
  {
    type: "result",
    subtype: "success",
    total_cost_usd: 0.15,
    usage: { input_tokens: 2, cache_read_input_tokens: 10, cache_creation_input_tokens: 3, output_tokens: 5 },
  },
);

describe("an account of a Claude Code session", () => {
  const got = account(claude);
  it("keeps what it said, each call with its result, and the end with what it used", () => {
    expect(got.steps.map((s) => s.kind)).toEqual(["said", "call", "call", "end"]);
    expect(got.steps[0]).toMatchObject({ text: "Reading the plan first." });
    expect(got.steps[1]).toMatchObject({
      tool: "Bash",
      arg: "ls src",
      out: { lines: ["a", "b", "c", "d", "e"] },
    });
    expect(got.steps[3]).toMatchObject({ tokens: 20, usd: 0.15, error: false });
  });
  it("marks a result that was an error, whatever shape its content has", () => {
    expect(got.steps[2]).toMatchObject({
      tool: "Read",
      arg: "/w/x.ts",
      out: { error: true, lines: ["nope"] },
    });
  });
  it("counts the hook, system, thinking, rate and progress events it left out", () => {
    expect(got.quiet).toBe(5);
  });
});

describe("an account of a Codex session", () => {
  const item = (type: string, rest: object) => ({ type: "item.completed", item: { id: "i", type, ...rest } });
  const got = account(
    j(
      { type: "thread.started", thread_id: "t" },
      { type: "turn.started" },
      item("agent_message", { text: "Checking." }),
      {
        type: "item.started",
        item: { id: "1", type: "command_execution", command: "x", status: "in_progress" },
      },
      item("command_execution", {
        command: `/bin/zsh -lc "rg --files src"`,
        aggregated_output: "src/a.ts\nsrc/b.ts\n",
        exit_code: 1,
        status: "failed",
      }),
      item("mcp_tool_call", { server: "factor", tool: "handoff_write", arguments: { handoff: {} } }),
      item("reasoning", { text: "hm" }),
      { type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 90, output_tokens: 7 } },
    ),
  );
  it("shows a command without its shell wrapper, failed when it failed, and ignores a call only started", () => {
    expect(got.steps.map((s) => s.kind)).toEqual(["said", "call", "call", "end"]);
    expect(got.steps[1]).toMatchObject({
      tool: "shell",
      arg: "rg --files src",
      out: { error: true, lines: ["src/a.ts", "src/b.ts"] },
    });
    expect(got.steps[2]).toMatchObject({ tool: "factor: handoff_write" });
    expect(got.steps[3]).toMatchObject({ tokens: 107 });
  });
  it("leaves out the thread and turn events, the started call and the reasoning, with a count", () => {
    expect(got.quiet).toBe(4);
  });
});

describe("an account of what it does not know", () => {
  it("shows a line that is not JSON, or an event of a shape it has not seen, as a plain line", () => {
    const got = account(`not json\n${j({ type: "brand_new", x: 1 })}\n[1,2]\n\n{"type":"assis`);
    expect(got.steps.map((s) => s.kind)).toEqual(["plain", "plain", "plain", "plain"]);
    expect(got.steps[0]).toMatchObject({ text: "not json" });
  });
  it("shows a result it cannot pair, and a call that has no result yet", () => {
    const got = account(j(back("zz", "late"), use("t", "Mystery", { a: 3, q: "why" })));
    expect(got.steps).toMatchObject([{ kind: "plain" }, { kind: "call", tool: "Mystery", arg: "why" }]);
    expect((got.steps[1] as { out?: unknown }).out).toBeUndefined();
  });
  it("is empty for an empty transcript", () => {
    expect(account("")).toEqual({ steps: [], quiet: 0, hidden: 0 });
  });
});

describe("an account stays small", () => {
  it("clips long text, results and the number of steps, and says how many it left", () => {
    const said = (i: number) => ({
      type: "assistant",
      message: { content: [{ type: "text", text: `${i} ${"x".repeat(5000)}` }] },
    });
    const got = account(j(...Array.from({ length: 10 }, (_, i) => said(i))), 4);
    expect(got.steps).toHaveLength(4);
    expect(got.hidden).toBe(6);
    expect((got.steps[0] as { text: string }).text.length).toBeLessThan(2100);
    const big = account(j(use("t", "Bash", { command: "y".repeat(900) }), back("t", "z\n".repeat(500))));
    const call = big.steps[0] as { arg: string; out: { lines: string[]; more: number } };
    expect(call.arg.length).toBeLessThan(310);
    expect(call.out.lines).toHaveLength(40);
    expect(call.out.more).toBe(460);
  });
  it("strips what could reorder or hide text from every line it shows", () => {
    const got = account(
      j({ type: "assistant", message: { content: [{ type: "text", text: "a‮b\u0007c" }] } }),
    );
    expect(got.steps[0]).toMatchObject({ text: "a b c" });
  });
});

describe("whose session a transcript is", () => {
  it("names the panel member from the file's name, and no one for a lane's own agent or its later try", () => {
    const at = (name: string) => memberOf(`.factor/runs/abc/sessions/${name}`);
    expect(at("04-review.correctness.jsonl")).toBe("correctness");
    expect(at("04-review.correctness.2.jsonl")).toBe("correctness");
    expect(at("01-plan.jsonl")).toBeUndefined();
    expect(at("01-plan.2.jsonl")).toBeUndefined();
    expect(at("odd.jsonl")).toBeUndefined();
  });
});
