# Agent CLIs: headless runs, usage output, MCP and skills
Read on 2026-11-10.

## Claude Code

Sources: https://code.claude.com/docs/en/headless , https://code.claude.com/docs/en/cli-reference , https://code.claude.com/docs/en/env-vars

**Run one prompt.** `claude -p "<prompt>" --output-format json`. The prompt can also come on stdin. Formats: `text` (default), `json` (one result object), `stream-json` (one JSON object per line; the docs pair it with `--verbose`; the last line is the same `result` object). Exit code is 0 on success, non-zero on failure. A failure inside the run, such as a missing login, is still printed as the result on stdout. SIGTERM gives exit code 143 and no result.

**Result object** (seen locally; typed as `SDKResultMessage` in https://code.claude.com/docs/en/agent-sdk/typescript ):
- `session_id`, `result` (final text), `structured_output` (only with `--json-schema`).
- `subtype`: `success`, `error_max_turns`, `error_during_execution`, `error_max_budget_usd`, `error_max_structured_output_retries`. Error results carry `errors: string[]` and no `result`.
- `is_error`, `stop_reason`, `terminal_reason`, `api_error_status`, `permission_denials`.
- `num_turns`, `duration_ms`, `duration_api_ms`.
- `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens`.
- `total_cost_usd`, and `modelUsage.<model>.costUSD`. Both are client-side estimates. After `--resume` or `--continue` the total covers the whole conversation, so the factory must subtract earlier runs.

Checked locally:
```text
$ claude --version
2.1.311 (Claude Code)
$ claude --help   (trimmed)
Usage: claude [options] [command] [prompt]
  -p, --print                  Print response and exit
  --output-format <format>     "text" (default), "json", or "stream-json"
  --model <model>              --effort <level>  (low, medium, high, xhigh, max)
  --system-prompt <prompt>     --append-system-prompt <prompt>
  --allowedTools <tools...>    --disallowedTools <tools...>   --tools <tools...>
  --permission-mode <mode>     acceptEdits, auto, bypassPermissions, manual, dontAsk, plan
  --mcp-config <configs...>    --strict-mcp-config   --plugin-dir <path>
  --settings <file-or-json>    --setting-sources <sources>   --bare
  --session-id <uuid>   -n, --name <name>   -r, --resume [value]   -c, --continue
$ claude -p "Reply with the single word ok" --output-format json   (stdout, trimmed)
{"type":"result","subtype":"success","is_error":false,"result":"ok",
 "session_id":"<redacted>","num_turns":1,
 "duration_ms":4305,"duration_api_ms":4069,"stop_reason":"end_turn",
 "terminal_reason":"completed","permission_denials":[],
 "total_cost_usd":0.26956600000000003,
 "usage":{"input_tokens":2,"cache_creation_input_tokens":26094,
  "cache_read_input_tokens":11382,"output_tokens":117, ...},
 "modelUsage":{"claude-fable-5-2":{"inputTokens":2,"outputTokens":117,
  "costUSD":0.26956600000000003, ...}}, ...}
```
The run also printed a diagnostic line on stderr before the JSON (`[claude-code:unrecognized_model] {...}`). Note the cost: a one word reply cost 0.27 USD, because the default profile sent about 37,000 input tokens of context.

**Flags.**
- Model: `--model`. Effort: `--effort`.
- System prompt: `--append-system-prompt` adds, `--system-prompt` replaces.
- Tools: `--allowedTools "Bash(git diff *),Read"` (permission rule syntax), `--disallowedTools`, `--tools` (limits the built-in set).
- Permission mode: `--permission-mode`. From v2.1.302 a `-p` run starts in Manual mode when nothing sets one, and a call that needs approval is denied.
- Max turns: `--max-turns <n>` is in the docs but not in local `--help`. Not verified on 2.1.311.
- Working directory: no flag. Start the process in the worktree. `--add-dir` adds more.
- Sessions: `--session-id <uuid>` picks the id up front, `-n` names it, `--resume <id or name>`, `--continue`, `--fork-session`.

**Profile folder.** `CLAUDE_CONFIG_DIR` (default `~/.claude`) moves settings, session history, plugins, personal skills and `.claude.json`. Transcripts are `projects/<project>/<session-id>.jsonl`, in plain text. Login is `.credentials.json` in that folder on Linux and Windows. On macOS it is a Keychain entry keyed to that folder, so each profile has its own login. See https://code.claude.com/docs/en/authentication and https://code.claude.com/docs/en/claude-directory .

**MCP, skills, plugins.** `--mcp-config <file-or-json>` takes the `.mcp.json` shape, `{"mcpServers":{"name":{"type":"http","url":"..."}}}`. `--strict-mcp-config` ignores every other MCP source. Invalid entries are skipped without failing the run; they show in `mcp_server_errors` of `system/init`. Skills load from `.claude/skills/<name>/SKILL.md` in the project and from `skills/` in the profile folder. Plugins: the profile folder, or `--plugin-dir` for one run. A `-p` run loads the worktree's own hooks and `.mcp.json` servers with no trust prompt. See https://code.claude.com/docs/en/mcp and https://code.claude.com/docs/en/skills .

**Hooks for one run.** `--settings <file-or-json>` accepts a `hooks` key in the normal settings shape. It sits above user and project files and writes nothing. Hook entries merge across levels, so guard hooks are added to the user's hooks. `--bare` skips all hooks, also those from `--settings`, and does not read the subscription login. See https://code.claude.com/docs/en/settings and https://code.claude.com/docs/en/hooks .

## Codex

Sources: https://developers.openai.com/codex/noninteractive (today it redirects to https://learn.chatgpt.com/docs/non-interactive-mode ), https://learn.chatgpt.com/docs/config-file/config-reference , https://github.com/openai/codex

**Run one prompt.** `codex exec --json "<prompt>"`. Without `--json`, progress goes to stderr and only the final message goes to stdout. With `--json`, stdout is JSONL events: `thread.started` (carries `thread_id`), `turn.started`, `item.started`, `item.completed`, `turn.completed`, `turn.failed`, `error`. The final message is the last `item.completed` whose `item.type` is `agent_message`; `-o <file>` also writes it to a file. Token usage is in `turn.completed.usage`. There is no cost field. Exit code was 0 on success. Exit codes on failure: Not verified, the docs do not list them.

Checked locally:
```text
$ codex --version
codex-cli 0.167.0
$ codex --help   (trimmed)
  -c, --config <key=value>     dotted path, value parsed as TOML
  -m, --model <MODEL>          -p, --profile <CONFIG_PROFILE_V2>
  -s, --sandbox <SANDBOX_MODE> read-only, workspace-write, danger-full-access
  -a, --ask-for-approval <APPROVAL_POLICY>   on-request, never
  -C, --cd <DIR>               --add-dir <DIR>
$ codex exec --help   (trimmed)
Usage: codex exec [OPTIONS] [PROMPT]
  resume  Resume a previous session by id or pick the most recent with --last
  --skip-git-repo-check   --ephemeral
  --ignore-user-config    Do not load `$CODEX_HOME/config.toml`; auth still uses `CODEX_HOME`
  --output-schema <FILE>  --json   -o, --output-last-message <FILE>
$ codex exec --json --skip-git-repo-check "Reply with the single word ok"   (stdout)
{"type":"thread.started","thread_id":"<redacted>"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ok"}}
{"type":"turn.completed","usage":{"input_tokens":21871,"cached_input_tokens":7168,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}
```
On stderr the run printed `Reading additional input from stdin...` and two `ERROR rmcp::transport::worker` lines from a global MCP server that needed login. Exit code 0. `-a` is not listed under `codex exec --help`.

**Flags and config.**
- Model: `-m`. Reasoning effort: `-c model_reasoning_effort="high"` (`low`, `medium`, `high`, `xhigh`, `max`, `ultra`, depending on the model).
- Sandbox: `-s`. `exec` is read-only by default. Approval: `-c approval_policy="never"` (`on-request` or `never`). `--full-auto` is no longer supported.
- Working directory: `-C <dir>`. It must be inside a git repository unless `--skip-git-repo-check` is given.
- Profile folder: `CODEX_HOME` (default `~/.codex`) holds `config.toml`, `auth.json` (or the OS keyring), `history.jsonl`, logs and `sessions/`. `-p <name>` layers `$CODEX_HOME/<name>.config.toml` on top. Whether a keyring login is separate per `CODEX_HOME`: Not verified. `CODEX_API_KEY` sets a key for one run.
- Any config key: `-c key=value`, repeatable. Output schema: `--output-schema <file>`.
- Resume: `codex exec resume <SESSION_ID> "<prompt>"` or `codex exec resume --last`. The id is the `thread_id`. `--ephemeral` saves no session.

**MCP.** Servers are `[mcp_servers.<name>]` tables in `$CODEX_HOME/config.toml`, or in `.codex/config.toml` of a trusted project. Keys: `command`, `args`, `env`, `cwd` for stdio; `url`, `bearer_token_env_var` for HTTP; plus `enabled`, `required`, `enabled_tools`, `disabled_tools`. One run can add servers with `-c`, checked locally without a model call:
```text
$ codex mcp list -c 'mcp_servers.sf_probe.command="echo"' -c 'mcp_servers.sf_probe.args=["hi"]'
sf_probe  echo     hi     -    -    enabled  Unsupported
```
Source: https://learn.chatgpt.com/docs/extend/mcp

## Kimi

Sources: https://github.com/MoonshotAI/kimi-cli , https://github.com/MoonshotAI/kimi-code , https://moonshotai.github.io/kimi-code/en/

**The kimi-cli repo is archived.** Its README says the Python Kimi CLI "has been archived and is no longer maintained" and that existing installs "will stop working". The replacement is Kimi Code CLI in MoonshotAI/kimi-code (`npm install -g @moonshot-ai/kimi-code`). The binary is still `kimi`. Build the adapter for Kimi Code CLI. Nothing here was run locally.

Kimi Code CLI, from https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/reference/kimi-command.md and the `configuration` and `customization` pages beside it:
- Run one prompt: `kimi -p "<prompt>"`. No UI opens. `--output-format text` (default) or `stream-json`, only with `-p`. Thinking and tool progress go to stderr.
- `stream-json`: one JSON object per stdout line: assistant messages, and for a tool call an assistant message with `tool_calls` followed by a tool message. Exact field names: Not verified.
- Token usage and cost in the output: Not verified. The docs describe no usage or cost field.
- Exit codes for `-p`: Not verified.
- Approvals: `-p` runs under the `auto` policy and asks nobody. It cannot be combined with `--yolo`, `--auto` or `--plan`.
- Model: `-m <alias>`, otherwise `default_model` in `config.toml`. A provider `api_key` is read from `config.toml` only, not from an exported shell variable.
- Sessions: `-S <id>`, or `-c` for the latest one in the folder.
- Working directory: no flag is documented.
- Profile folder: `KIMI_CODE_HOME` (default `~/.kimi-code`) moves `config.toml`, `mcp.json`, `credentials/` (OAuth login), `sessions/`, `skills/` and logs. Login without the UI: `kimi login`.
- MCP: `$KIMI_CODE_HOME/mcp.json` (user) and `.kimi-code/mcp.json` in the working directory (project), both `{"mcpServers":{...}}`. Project entries win on a name clash. A headless run leaves project servers off unless the folder is trusted; `KIMI_CODE_TRUST_WORKSPACE=1` trusts it for that process. No flag for a one-run MCP file is documented.
- Skills: `--skills-dir <dir>` replaces the discovered folders for one run.

The archived CLI used `kimi --print`, `--mcp-config-file` and `KIMI_SHARE_DIR`. The new docs list none of these.

## Skills (npx skills)

Sources: https://github.com/vercel-labs/skills (README, `docs/commands.md`, `docs/agents.md`, `docs/api.md`), https://skills.sh

Commands run as `npx skills <command>`. Local check: `npx --yes skills --help` worked over the network. Version 1.7.6. It needs Node.js 22.20 or later.

- `add <source>`: `-g` global, `-a <agents>`, `-s <skills>`, `-l` list only, `-y` no prompts, `--copy` (the default is a symlink to one shared copy), `--all`, `--json`.
- `list` or `ls`: `-g`, `-a`, `--json`. The default scope is the project.
- `remove [skills]`: `-g`, `-a`, `-s`, `-y`, `--all`.
- `update [skills...]`: `-g`, `-p`, `-y`.
- `find [query]`: `--owner <owner>`. Whether `find <query>` runs without prompts: Not verified.

| Agent (`-a` name) | Project folder | Global folder |
| --- | --- | --- |
| Claude Code (`claude-code`) | `.claude/skills/` | `~/.claude/skills/` |
| Codex (`codex`) | `.agents/skills/` | `~/.agents/skills/` |
| Kimi Code CLI (`kimi-code-cli`) | `.agents/skills/` | `~/.agents/skills/` |

Non-interactive call: `npx --yes skills add <source> --skill <name> -a claude-code -a codex -y --json`, run in the worktree. Whether `-g` follows `CLAUDE_CONFIG_DIR`: Not verified. A TypeScript tool can skip the CLI: `import { installSkills } from 'skills'` (ESM only).

## MCP servers per run

Sources: https://code.claude.com/docs/en/cli-reference , https://learn.chatgpt.com/docs/config-file/config-advanced , https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/customization/mcp.md

- **Claude Code.** Write a JSON file outside the repo and pass `--mcp-config <file> --strict-mcp-config`. Nothing is written to user or project config.
- **Codex.** Pass each server as `-c 'mcp_servers.<name>.<key>=<toml value>'`. Add `--ignore-user-config` so the user's own servers do not load; login still comes from `CODEX_HOME`. Both flags together in a real run: Not verified. Set `required = true` when a missing server must fail the run.
- **Kimi Code.** Write `.kimi-code/mcp.json` in the run's worktree, set `KIMI_CODE_TRUST_WORKSPACE=1`, and keep the file out of commits. User servers from `$KIMI_CODE_HOME/mcp.json` still merge in. To drop them, use a per-run `KIMI_CODE_HOME`. Not verified by a run.

## What a CLI prints when the account's limit is reached

Not verified for any of the three CLIs: no run here has hit a limit, and the documentation read for this note
gives no exact text. The adapters look for "usage limit", "rate limit", "limit reached", "quota exceeded",
"out of credits" and "too many requests", and only in an error the CLI reported (a Claude result with
`is_error`, a Codex `turn.failed` or `error` event, the diagnostics of a run that exited non-zero). When a real
message is seen, record it here with its reset time format, and replace the fixed one-hour hold.

Checked from `codex exec --help` (0.167.0): with `-` as the prompt, or with none, the instructions are read
from stdin. Checked from `claude --help` (2.1.311): `--tools` sets the built-in tools that exist for the run,
`--allowedTools` and `--disallowedTools` set which need no approval or are refused.

Codex's `turn.completed.usage` also has `cache_write_input_tokens` (0 in the run above). The adapter takes it,
like `cached_input_tokens`, to be a part of `input_tokens`. Not verified: no run here has shown it above 0.
Also not verified: whether `usage` in `turn.completed` is that turn's or the thread's running total. The adapter
adds the turns up, which is right for the one turn a `codex exec` makes, and would count twice if a stream ever
held two finished turns with running totals.

## Checked by real runs on 2026-11-10

Claude Code 2.1.311, started by the factory as
`claude -p --output-format stream-json --verbose --model sonnet --add-dir <lane folder> --settings <hooks as JSON> --setting-sources user --strict-mcp-config --mcp-config <one server as JSON> --tools Read,Glob,Grep,Bash,Write,Edit,NotebookEdit --allowedTools <the same, and mcp__factor__*>`,
with the prompt on stdin:

- Every flag was accepted. The `init` event listed exactly the tools named, and the five `mcp__factor__*` tools.
- The hand-written MCP server connected (`"status":"connected"`), and `memory_note` and `handoff_write` worked.
- A `PreToolUse` hook given with `--settings` runs under `--setting-sources user`: it denied `cat .env` with
  the factory's reason. The owner's own hooks from the profile run too (one refused a commit with an AI
  co-author trailer).
- The result's `modelUsage` named the full model (`claude-sonnet-5-5`), and `total_cost_usd` was a number.

Codex 0.167.0, started as
`codex exec --json -C <worktree> -s read-only --ignore-user-config -c approval_policy="never" -m gpt-6.1-sol -c mcp_servers.factor.command=... -c mcp_servers.factor.args=[...] -c mcp_servers.factor.default_tools_approval_mode="approve" -`:

- Accepted, with the prompt on stdin. The login still works with `--ignore-user-config`. Skills in the owner's
  home are still loaded.
- Without `default_tools_approval_mode="approve"` every tool of the server is refused: `MCP tool call requires
  approval, but approval policy is never`. With it, `memory_read` and `handoff_write` worked, from a read-only
  sandbox. A tool call shows in the stream as an `item.completed` of type `mcp_tool_call`.
- `gpt-5.3-codex` is refused for a ChatGPT login. `codex debug models` lists the models the CLI knows. The
  stream does not name the model that ran.
- One turn gave one `turn.completed`, with `cached_input_tokens` inside `input_tokens` (149,340 and 122,752).

## What we take

Source: https://code.claude.com/docs/en/headless and the sections above.

- Each adapter spawns the binary in the worktree, closes stdin, and reads stdout and stderr as two streams.
- Claude guard hooks go in through `--settings`. Codex cost is computed by us from a price table.
- Skills are installed into the worktree with `npx skills add ... -y`, not globally.

| CLI | Command line to run one prompt | How to pick the profile | MCP servers for one run | Where usage and cost appear |
| --- | --- | --- | --- | --- |
| Claude Code | `claude -p "<prompt>" --output-format stream-json --verbose` | `CLAUDE_CONFIG_DIR=<dir>` | `--mcp-config <file> --strict-mcp-config` | Final `result` object: `usage.*`, `total_cost_usd`, `modelUsage` |
| Codex | `codex exec --json -C <worktree> "<prompt>"` | `CODEX_HOME=<dir>`, optional `-p <name>` | `-c 'mcp_servers.<name>.<key>=...'` with `--ignore-user-config` | `turn.completed.usage`: tokens only, no cost |
| Kimi Code | `kimi -p "<prompt>" --output-format stream-json` | `KIMI_CODE_HOME=<dir>` | `.kimi-code/mcp.json` in the worktree with `KIMI_CODE_TRUST_WORKSPACE=1` | Not verified |

## What we avoid

Source for the `--bare` point: https://code.claude.com/docs/en/headless

- The archived Python Kimi CLI and its flags.
- `claude --bare` for factory runs. It skips hooks, so guard hooks would not run, and it needs an API key. The docs say it will become the default for `-p` later, so the adapter must check for that.
- Merging stderr into stdout. Both installed CLIs print non-JSON lines on stderr.
- Reading `total_cost_usd` as the cost of one run after a resume.
- `claude mcp add`, `codex mcp add`, or editing the user's `mcp.json`, to set up one run.
- The `--dangerously-*` bypass flags as a default.
- Leaving stdin open, and reading login files.

## Sources

- https://code.claude.com/docs/en/headless
- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/llms.txt
- https://developers.openai.com/codex/noninteractive
- https://github.com/openai/codex
- https://github.com/MoonshotAI/kimi-cli
- https://github.com/MoonshotAI/kimi-code
- https://github.com/vercel-labs/skills
- https://skills.sh
