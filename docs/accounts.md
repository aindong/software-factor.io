# Accounts, roles and the guard

A workflow names roles, such as `author` and `reviewer`. It never names a model, an account or a login, so the
same file runs on any machine. Each machine says which agent login works each role.

## Accounts

An account is one login of an agent CLI on this machine. The login stays where the CLI keeps it, in the CLI's
own profile folder. The factory stores only the folder's path, in `accounts.json` under the factor home
(`~/.factor`, or `FACTOR_HOME`). There is never a key or a token in that file.

```sh
softwarefactor account add work --agent claude --profile ~/.claude --limit 5h=2000000
softwarefactor account add client-a --agent claude --profile ~/.claude-client-a
softwarefactor account add codex --agent codex --profile ~/.codex
softwarefactor account add script --agent command --command 'my-agent "$FACTOR_PROMPT_FILE"'
softwarefactor account list
softwarefactor account remove client-a
```

| Agent | How it is started | Profile folder | What holds it back |
| --- | --- | --- | --- |
| `claude` | `claude -p --output-format stream-json --verbose`, the prompt on stdin | `CLAUDE_CONFIG_DIR` | The guard, as a hook before every tool call. Only the tools the lane's access allows. |
| `codex` | `codex exec --json -C <worktree> -`, the prompt on stdin | `CODEX_HOME` | The CLI's own sandbox: `read-only` or `workspace-write`, no approval prompts. |
| `kimi` | `kimi -p "<prompt>" --output-format stream-json` | `KIMI_CODE_HOME` | Nothing but the gates. The run says so. Not yet tried with the real CLI. |
| `command` | The account's shell command, in the worktree | none | Nothing but the gates. The run says so. |

A CLI's default folder (`~/.claude`, `~/.codex`) is not passed as a variable, so the login is found exactly as
when you run the CLI yourself.

An agent's process gets a short list of basic variables (`PATH`, `HOME` and the like), the run's slot
(`FACTOR_PORT` and the others), and where to hand off. It never gets an API key from your environment.

## Roles

```sh
softwarefactor role bind author --account work --large opus --medium sonnet --small haiku --effort high
softwarefactor role bind reviewer --account codex
softwarefactor role list
```

The binding is written to `.factor/local.json`, which is not committed. A lane asks for a tier (`small`,
`medium`, `large`) and the binding turns it into a model. A tier with no model uses the CLI's default. `role
list` shows each role with its account, and flags a role that the workflow wants on a different vendor
(`differentVendorFrom`) when both are on the same one.

## Limits

`--limit 5h=2000000` says the account may use that many tokens in any five hours. Every agent start writes what
it used to `usage.jsonl` under the factor home, so the count covers every workspace on this machine. When an
account reaches the headroom (`--headroom`, default 0.9 of the limit), no lane starts on it: the run is parked
with the code `account_limit` and a wake time, and `softwarefactor run` continues it when enough usage has left
the window. The factory only knows the usage of its own runs, not what you used by hand.

When a CLI reports that the limit is reached, the account is held for one hour and the lane starts again after
that. The exact words each CLI uses for this are not verified: the factory looks for "usage limit", "rate
limit" and similar, and only in an error the CLI reported, never in ordinary output.

## What a lane may do

- A lane with `access: "write"` works in its worktree. What its agent leaves uncommitted is committed by the
  host, so the gates judge all of it. (Codex in its sandbox cannot commit itself.)
- A lane with `access: "read"` leaves nothing. If its agent commits or changes a tracked file, the lane fails
  and the change is dropped. A scratch file is removed and the run says so. Claude Code gets no file-writing
  tool on such a lane, and Codex a read-only sandbox.
- An agent that cannot write its hand-off file gives the hand-off in its last message, as a JSON block.

## The guard

`softwarefactor guard` is the hook Claude Code calls before each tool call. It denies:

- a write outside the worktree and the lane's own folder, into `.git`, or into `.factor`
- reading files that hold secrets: env files, SSH and cloud keys, the CLIs' login files, the keychain
- `sudo`, a push to the default branch, a forced push, a recursive delete outside the worktree
- a download piped into a shell, and a change to git's configuration or hooks

Anything it cannot read is denied. It is a list of patterns over one tool call, so it stops accidents and plain
attempts, not a determined shell: a command can always be spelled in a way a list misses. The second wall is the
gates, which run on the host on a clean checkout of what was committed (see `docs/workflow-schema.md`). A
sandbox is the third, and it is not built yet.
