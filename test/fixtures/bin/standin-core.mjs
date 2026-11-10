// A stand-in for an agent CLI, for tests. It prints the output shape the real CLI prints (recorded in
// docs/research/agent-clis.md), does what `standin.json` in its profile folder says, and writes down
// how it was called in `calls.jsonl` there, so a test can check the flags and the environment.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PROFILE_ENV = { claude: "CLAUDE_CONFIG_DIR", codex: "CODEX_HOME", kimi: "KIMI_CODE_HOME" };
const KEPT = /^(FACTOR_|CLAUDE_|CODEX_|KIMI_|ANTHROPIC_|OPENAI_|AWS_)/;
const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

export async function standin(kind) {
  const profile = process.env[PROFILE_ENV[kind]];
  if (!profile || !existsSync(profile)) {
    process.stderr.write(`${kind} stand-in: no profile folder in ${PROFILE_ENV[kind]}\n`);
    process.exit(3);
  }
  const argv = process.argv.slice(2);
  const cdAt = argv.indexOf("-C");
  if (cdAt >= 0) process.chdir(argv[cdAt + 1]);
  const stdin = process.stdin.isTTY ? "" : readFileSync(0, "utf8");
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => KEPT.test(k)));
  appendFileSync(
    join(profile, "calls.jsonl"),
    `${JSON.stringify({ argv, cwd: process.cwd(), stdin, env })}\n`,
  );

  writeFileSync(join(profile, "pid"), String(process.pid));
  // like the real CLI, a JSON stream in print mode needs --verbose
  if (kind === "claude" && argv.includes("stream-json") && !argv.includes("--verbose")) {
    process.stderr.write("Error: --output-format=stream-json requires --verbose\n");
    process.exit(1);
  }
  const planFile = join(profile, "standin.json");
  const plan = existsSync(planFile) ? JSON.parse(readFileSync(planFile, "utf8")) : {};
  process.stderr.write(`[${kind}-standin] a diagnostic line on stderr, like the real CLI prints\n`);
  let final = plan.final ?? "Done.";
  for (const a of plan.actions ?? []) {
    if (a.write) {
      mkdirSync(dirname(a.write.path), { recursive: true });
      writeFileSync(a.write.path, a.write.content);
    } else if (a.commit) {
      try {
        execFileSync("git", ["add", "-A"]);
        const who = ["-c", "user.name=standin", "-c", "user.email=standin@localhost"];
        execFileSync("git", [...who, "commit", "-q", "-m", a.commit], { stdio: "ignore" });
      } catch {
        // nothing to commit
      }
    } else if (a.handoff) {
      writeFileSync(process.env.FACTOR_HANDOFF, JSON.stringify(a.handoff));
    } else if (a.final) {
      final = typeof a.final === "string" ? a.final : JSON.stringify(a.final);
    } else if (a.sh) {
      spawnSync("sh", ["-c", a.sh], { stdio: "ignore" }); // a shell command, as an agent with a shell can run
    } else if (a.spawn) {
      spawn("sh", ["-c", a.spawn], { stdio: "ignore" }); // something the agent started and left running
    } else if (a.tool) {
      // ask the hooks given for this run, as the real CLI does before each tool call
      const at = argv.indexOf("--settings");
      const settings = at >= 0 ? JSON.parse(argv[at + 1]) : {};
      const input = JSON.stringify({ tool_name: a.tool.name, tool_input: a.tool.input, cwd: process.cwd() });
      for (const entry of settings.hooks?.PreToolUse ?? []) {
        for (const hook of entry.hooks ?? []) {
          const r = spawnSync("sh", ["-c", hook.command], { input, encoding: "utf8" });
          const line = { tool: a.tool.name, matcher: entry.matcher, status: r.status, stderr: r.stderr };
          appendFileSync(join(profile, "hooks.jsonl"), `${JSON.stringify(line)}\n`);
        }
      }
    } else if (a.sleep) {
      await new Promise((r) => setTimeout(r, a.sleep));
    }
  }

  if (kind === "claude") {
    say({ type: "system", subtype: "init", session_id: "claude-session-1" });
    say({ type: "assistant", message: { content: [{ type: "text", text: final }] } });
    if (plan.noResult) process.exit(143); // as when the real CLI is killed: no result line
    say({
      type: "result",
      // an error result carries `errors` and no `result`, or is a "success" whose text is the error
      subtype: plan.error && !plan.errorAsResult ? "error_during_execution" : "success",
      is_error: Boolean(plan.error),
      ...(plan.error && !plan.errorAsResult ? { errors: [plan.error] } : { result: plan.error ?? final }),
      session_id: "claude-session-1",
      num_turns: 3,
      duration_ms: 1200,
      total_cost_usd: 0.42,
      // a real result can list more than one model: the small one that did side work comes first here
      modelUsage: {
        "claude-standin-small": { inputTokens: 10, outputTokens: 5, costUSD: 0.02 },
        [plan.modelName ?? "claude-standin-1"]: { inputTokens: 90, outputTokens: 45, costUSD: 0.4 },
      },
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 200,
      },
    });
  } else if (kind === "codex") {
    say({ type: "thread.started", thread_id: "codex-thread-1" });
    say({ type: "turn.started" });
    if (plan.retried) say({ type: "error", message: plan.retried }); // a retry the CLI recovers from
    if (plan.error) say({ type: "turn.failed", error: { message: plan.error } });
    else {
      say({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: final } });
      say({
        type: "turn.completed",
        usage: {
          input_tokens: 2000,
          cached_input_tokens: 500,
          cache_write_input_tokens: 100,
          output_tokens: 300,
          reasoning_output_tokens: 40,
        },
      });
    }
  } else {
    say({ role: "assistant", content: final });
  }
  process.exit(plan.exit ?? (plan.error ? 1 : 0));
}
