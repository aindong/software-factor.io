// One sentence for what a run is doing now, from what the record holds. The output lines are the
// shapes the real Claude Code and Codex printed in the phase 3 exit check.
import { describe, expect, it } from "vitest";
import type { Parked, StopCode } from "../../src/core/engine/state.ts";
import { activityOf, type Now, sentenceOf } from "../../src/core/runs/sentence.ts";

const line = (o: unknown) => JSON.stringify(o);
const claude = (content: unknown[]) => line({ type: "assistant", message: { content } });
const use = (name: string, input: Record<string, unknown>) => ({ type: "tool_use", name, input });
const codex = (type: string, item: Record<string, unknown>) => line({ type, item });

describe("what an agent's output says it is doing", () => {
  it.each([
    [[claude([use("Bash", { command: "npm test" })])], "running `npm test`"],
    [
      [claude([use("Bash", { command: "cat > a.js <<'E'\nexport const a = 1;\nE\nnpm test" })])],
      "running `cat > a.js <<'E'`",
    ],
    [[claude([use("Read", { file_path: "/tmp/work/ws/run1/src/core/store.ts" })])], "reading core/store.ts"],
    [[claude([use("Edit", { file_path: "/tmp/work/ws/run1/src/a.ts" })])], "writing src/a.ts"],
    [[claude([use("Write", { file_path: "notes.md" })])], "writing notes.md"],
    [[claude([use("Grep", { pattern: "addEvent\\(" })])], 'searching for "addEvent\\("'],
    [[claude([use("Glob", { pattern: "**/*.test.ts" })])], 'looking for files like "**/*.test.ts"'],
    [
      [claude([use("mcp__factor__memory_note", { title: "t", body: "b" })])],
      "leaving a note for later lanes",
    ],
    [[claude([use("mcp__factor__memory_read", {})])], "reading what the project remembers"],
    [[claude([use("mcp__factor__handoff_write", { handoff: {} })])], "handing off"],
    [[claude([use("mcp__factor__ask_question", { question: "?" })])], "asking a person"],
    [[claude([use("mcp__factor__evidence_attach", { name: "a", text: "b" })])], "attaching evidence"],
    [
      [codex("item.started", { type: "command_execution", command: "/bin/zsh -lc 'npm test'" })],
      "running `npm test`",
    ],
    [
      [codex("item.completed", { type: "command_execution", command: '/bin/bash -lc "git status --short"' })],
      "running `git status --short`",
    ],
    [
      [codex("item.started", { type: "mcp_tool_call", server: "factor", tool: "memory_read" })],
      "reading what the project remembers",
    ],
    [
      [codex("item.completed", { type: "mcp_tool_call", server: "factor", tool: "handoff_write" })],
      "handing off",
    ],
    [
      [codex("item.completed", { type: "file_change", changes: [{ path: "src/a.ts", kind: "update" }] })],
      "changing files",
    ],
  ])("%#: %s", (lines, wanted) => {
    expect(activityOf(lines.join("\n"))).toBe(wanted);
  });

  it("takes the latest thing done, and looks past talk and lines it does not know", () => {
    const tail = [
      claude([use("Bash", { command: "ls" })]),
      line({ type: "user", message: { content: [{ type: "tool_result", content: "a\nb" }] } }),
      claude([use("Read", { file_path: "src/b.ts" })]),
      claude([{ type: "text", text: "I have read the file." }]),
      line({ type: "rate_limit_event" }),
      "not json at all",
      '{"type":"assistant","message":{"content":"a string, not a list"}}',
      "{}",
      "null",
      "[1,2]",
    ].join("\n");
    expect(activityOf(tail)).toBe("reading src/b.ts");
  });

  it("says nothing when the output holds nothing it knows", () => {
    for (const tail of [
      "",
      "\n\n",
      "plain words",
      line({ type: "system", subtype: "init" }),
      '{"type":"assis',
    ]) {
      expect(activityOf(tail), JSON.stringify(tail)).toBeUndefined();
    }
  });

  it("skips a first line that was cut in the middle", () => {
    const whole = claude([use("Bash", { command: "pnpm test" })]);
    expect(activityOf(`${whole.slice(30)}\n${whole}`)).toBe("running `pnpm test`");
  });

  it("keeps an agent's words on one line, short, and free of control characters", () => {
    const wild = `echo one\u001b[31m\u0007 two\ttab ${"x".repeat(5000)}`;
    const said = activityOf(claude([use("Bash", { command: wild })])) ?? "";
    expect(said.length).toBeLessThanOrEqual(100);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: that none is left is the point
    expect(said).not.toMatch(/[\u0000-\u001f\u007f-\u009f‮]/);
    expect(said.startsWith("running `echo one")).toBe(true);
    const path =
      activityOf(claude([use("Read", { file_path: `/a/${"d/".repeat(900)}f.ts\nFORGED: done` })])) ?? "";
    expect(path).not.toContain("\n");
    expect(path.length).toBeLessThanOrEqual(100);
  });

  it("skips a line that is megabytes long and uses an earlier one", () => {
    const tail = [
      claude([use("Bash", { command: "npm test" })]),
      `{"type":"assistant","message":{"content":[{"type":"text","text":"${"y".repeat(5_000_000)}`,
    ].join("\n");
    expect(activityOf(tail)).toBe("running `npm test`");
  });

  it("never splits a character in two when it cuts", () => {
    for (let pad = 60; pad < 100; pad++) {
      const said =
        activityOf(claude([use("Bash", { command: `${"a".repeat(pad)}${"😀".repeat(40)}` })])) ?? "";
      expect(said.isWellFormed(), said).toBe(true);
    }
  });

  it("does not trip over odd shapes", () => {
    const odd = [
      claude([use("Bash", {})]),
      claude([use("Bash", { command: 7 })]),
      claude([{ type: "tool_use" }]),
      claude([null, 3, "x"]),
      codex("item.started", { type: "command_execution" }),
      codex("item.started", { type: "mcp_tool_call", tool: 5 }),
      line({ type: "item.started", item: null }),
      line({ type: "assistant", message: null }),
      line({ type: "assistant" }),
    ];
    for (const one of odd) expect(() => activityOf(one), one).not.toThrow();
    // a tool it has no words for is still named, never run together with the sentence
    expect(activityOf(claude([use("WebFetch", { url: "https://x.example" })]))).toBe("using WebFetch");
    expect(activityOf(claude([use("mcp__other__thing", {})]))).toBe("using mcp__other__thing");
    expect(activityOf(codex("item.started", { type: "mcp_tool_call", server: "other", tool: "x" }))).toBe(
      "using a tool",
    );
  });
});

describe("the sentence for a run", () => {
  const cases: [Now, string][] = [
    [
      {
        status: "running",
        lane: "Build",
        phase: "agent",
        tail: claude([use("Bash", { command: "npm test" })]),
      },
      "Build: the agent is running `npm test`.",
    ],
    [{ status: "running", lane: "Build", phase: "agent" }, "Build: the agent is working."],
    [{ status: "running", lane: "Build", phase: "agent", tail: "garbage" }, "Build: the agent is working."],
    [
      { status: "running", lane: "Build", phase: "gates", gatesDone: 2, gatesTotal: 3 },
      "Build: the agent has finished and its gates are running (2 of 3 done).",
    ],
    [
      { status: "running", lane: "Build", phase: "gates", gatesDone: 0, gatesTotal: 0 },
      "Build: the agent has finished and the host is checking its work.",
    ],
    [{ status: "running", lane: "Verify", phase: "command" }, "Verify: its command is running."],
    [{ status: "running", lane: "Review", phase: "panel", members: 3 }, "Review: 3 reviewers are at work."],
    [{ status: "running", lane: "Review", phase: "panel", members: 1 }, "Review: 1 reviewer is at work."],
    [{ status: "running" }, "Starting."],
    [
      { status: "waiting", lane: "Merge", parked: "approve-before" },
      "Merge waits for your approval before it runs.",
    ],
    [
      { status: "waiting", lane: "Plan", parked: "approve-after" },
      "Plan has finished and waits for your approval.",
    ],
    [
      { status: "waiting", lane: "Plan", parked: "answer" },
      "Plan asked a question and waits for your answer.",
    ],
    [
      { status: "waiting", lane: "Deploy", parked: "wait" },
      "Deploy waits for its condition and looks again by itself.",
    ],
    [{ status: "waiting", lane: "Build", parked: "account" }, "Build waits for its account's limit to lift."],
    [{ status: "waiting" }, "Waiting."],
    [{ status: "done", stopCode: "done", reason: 'lane "review" passed' }, "Done."],
    [
      { status: "dropped", stopCode: "dropped", reason: "the task is a duplicate" },
      "Dropped: the task is a duplicate.",
    ],
    [
      { status: "stopped", stopCode: "lane_failed", reason: 'lane "build" failed: tests are red' },
      'Stopped: lane "build" failed: tests are red.',
    ],
    [{ status: "stopped", stopCode: "stopped_by_person", reason: "" }, "Stopped by a person."],
    [
      { status: "stopped", stopCode: "crashed", reason: null },
      "Stopped: the process that ran it ended without a word.",
    ],
    [{ status: "stopped", stopCode: "budget_tokens" }, "Stopped: out of its token budget."],
    [{ status: "stopped", stopCode: "something_new" }, "Stopped (something_new)."],
    [{ status: "stopped" }, "Stopped."],
  ];
  it.each(cases)("%j", (now, wanted) => {
    expect(sentenceOf(now)).toBe(wanted);
  });

  it("is one line of at most 160 characters, whatever the record holds", () => {
    const long = "word ".repeat(200);
    const nows: Now[] = [
      { status: "stopped", stopCode: "lane_failed", reason: `${long}\nsecond line\u001b[2J` },
      { status: "dropped", reason: long },
      { status: "running", lane: long, phase: "agent", tail: claude([use("Bash", { command: long })]) },
      { status: "waiting", lane: `${long}\nApproved by the owner`, parked: "answer" },
    ];
    for (const now of nows) {
      const said = sentenceOf(now);
      expect(said.length, said).toBeLessThanOrEqual(160);
      // biome-ignore lint/suspicious/noControlCharactersInRegex: that none is left is the point
      expect(said).not.toMatch(/[\u0000-\u001f]/);
    }
  });

  it("has a sentence for every way the engine stops or parks a run", () => {
    // typed by the engine's own lists: a new stop code or a new way of waiting fails to compile here
    const stops: Record<StopCode, Now["status"]> = {
      done: "done",
      dropped: "dropped",
      lane_failed: "stopped",
      rejected: "stopped",
      out_of_rounds: "stopped",
      no_progress: "stopped",
      budget_minutes: "stopped",
      budget_tokens: "stopped",
      budget_usd: "stopped",
      gate_stop: "stopped",
      git_config_changed: "stopped",
      interrupted: "stopped",
      stopped_by_person: "stopped",
      crashed: "stopped",
      awaiting_approval: "waiting",
      needs_person: "waiting",
      waiting: "waiting",
      account_limit: "waiting",
    };
    const parks: Record<Parked["kind"], true> = {
      "approve-before": true,
      "approve-after": true,
      answer: true,
      wait: true,
      account: true,
    };
    const said = new Set<string>();
    for (const [stopCode, status] of Object.entries(stops)) {
      const sentence = sentenceOf({ status, stopCode });
      expect(sentence, stopCode).toMatch(/^[A-Z].*\.$/);
      expect(sentence, stopCode).not.toContain(`(${stopCode})`); // in words, not as its code
      if (status === "stopped") said.add(sentence);
    }
    expect(said.size, "each stop has words of its own").toBe(
      Object.values(stops).filter((s) => s === "stopped").length,
    );
    for (const parked of Object.keys(parks) as Parked["kind"][]) {
      const sentence = sentenceOf({ status: "waiting", lane: "Ship it", parked });
      expect(sentence, parked).toMatch(/^Ship it .*\.$/);
      expect(sentence.length).toBeLessThanOrEqual(160);
    }
  });

  it("says so when a run is marked as moving but its process is gone", () => {
    expect(sentenceOf({ status: "running", lane: "Build", phase: "agent", gone: true })).toBe(
      "Build: its process is gone. The next `softwarefactor run` takes the run up again or ends it.",
    );
  });

  it("names the lane also when it is long, and still fits", () => {
    const lane = `${"Lane ".repeat(40)}😀`;
    for (const now of [
      { status: "running", lane, phase: "agent" },
      { status: "waiting", lane, parked: "answer" },
    ] as Now[]) {
      const said = sentenceOf(now);
      expect(said.length).toBeLessThanOrEqual(160);
      expect(said.isWellFormed()).toBe(true);
      expect(said.startsWith("Lane Lane")).toBe(true);
    }
  });

  it("does not end a reason that has its own full stop with two", () => {
    expect(sentenceOf({ status: "stopped", stopCode: "gate_stop", reason: "The gate said stop." })).toBe(
      "Stopped: The gate said stop.",
    );
  });
});
