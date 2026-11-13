# Skills and servers on a lane

A lane that names no skill and no server starts sealed: file and shell tools (the writing ones only when its
access is `write`), the five tools of the factory's own server, and nothing from the account's profile. The
agent is not shown the profile's skills as callable, and its MCP servers are not loaded. This is what every
lane gets unless its workflow says more.

## Naming them

Declare what a lane may reach at the top of the workflow, then name it in the lane's `agent`:

```json
{
  "mcp": {
    "docs": { "from": "profile" },
    "tracker": { "from": "profile", "name": "my tracker" }
  },
  "skills": { "my-plugin:plan": { "from": "profile" } },
  "lanes": [
    {
      "id": "plan",
      "uses": "core/agent@1",
      "agent": {
        "role": "author",
        "access": "read",
        "prompt": "Plan the task.",
        "skills": ["my-plugin:plan"],
        "servers": ["docs", "tracker"]
      }
    }
  ]
}
```

- A server is declared with `"from": "profile"`. The key is the name the workflow uses; `name` is what the
  account's own profile calls it (`claude mcp list` prints it), and defaults to the key.
- `servers` on a lane's agent names declared profile servers. `skills` names declared skills. A profile skill
  goes by its key, which must be the name the Skill tool is called with. A skill from a repository goes by its
  `skill` name; with none (all the skills of that source) its names are not known, so the lane gets none of
  them.
- `*` (written `"*"`) in either list means every skill, or every server, of the account. It is a wide grant: use it only on a
  machine and a task you trust.
- `softwarefactor check` reports a lane that names something undeclared, and a profile server that no lane
  names. Two servers whose names become the same tool prefix (`a.b` and `a b` both become `a_b`), and a server
  that would be called `factor`, are refused.

## Allowing a server on this machine

A workflow can come from someone else, so a server it names is not used until you allow it here:

```sh
softwarefactor allow docs
softwarefactor allow '*'
```

The run stops before any task is claimed, and says which `softwarefactor allow` to run. The approval is kept
in `.factor/local.json` (not committed) by the server's name in the profile; a workflow that names another
profile name asks again. One lane's approval opens nothing for a server another lane names. A skill from a
profile needs no approval; one from a repository is allowed as before, with `softwarefactor allow --skill`.

## How it is held

Claude Code is started with the `Skill` tool when the lane names a skill, and without `--strict-mcp-config`
when it names a server. Every other server that `claude mcp list` prints for the account is disallowed by
name, and the guard, a hook before every tool call, is told the lane's skills and servers on its command line.
The guard allows a `Skill` call only when the skill's name is exactly one the lane names, and a tool
`mcp__<server>__<tool>` only when `<server>` is exactly a server the lane names after every character outside
`A-Za-z0-9_-` is turned into `_`. A name it cannot read is denied, and so is a tool name with a second `__`
in it: it could belong to another server. The factory's own tools stay allowed on every lane. The prompt tells
the agent which skills and servers it may use.

When `claude mcp list` fails or prints nothing readable, the factory cannot see the other servers, nor whether
two names would clash. The profile then cannot be listed, and the lane only starts if every server it names has a
name made of letters, digits, `-` and `_` (so its name in tool names is itself). A lane that names `*`, or a
server such as `my db`, does not start and says why. When it does start, its session record carries a notice that
the other servers could not be shut out; the guard still denies their tools. A server whose name, with odd
characters turned into `_`, ends in `_` or holds `__` is refused in the workflow check and at the start of the
lane, and so is a profile that lists a server called `factor`: rename or remove it there.

The guard also keeps the agent out of the CLI's own files: `.claude.json` and any `.claude*`, `.codex*`,
`.kimi-code*` or `.agents` folder at any depth, and the account's profile folder. The run stops if the servers in
the profile's `.claude.json` change while a lane works. The approval of a server is tied to the account the
lane's role is bound to here: bind the role to another account and the run asks again.

## What is not held

- A server reaches outside the worktree. It can read and change things the factory cannot see or undo, and
  the gates do not see what it did. A task that comes from a public issue can ask for it. What stands between
  is the label on the issue, the workflow file, your approval on this machine, and the person at the
  checkpoint.
- A skill may ask for tools the lane does not have, such as subagents. It then works in part.
- A lane that names a server starts every server of the profile, in the worktree's folder, and only hides the
  tools of the others (by name, and with the guard). A server started from a command may read files in that folder, whatever the lane may do.
- Without `--strict-mcp-config` the CLI could load a server from a project's own `.mcp.json`. It was checked on
  Claude Code 2.1.311 that a project's own `.mcp.json` is not loaded when the session reads only the user's
  settings, as these lanes do. It was not checked on a profile that turns on loading every project server.
- Checked on Claude Code 2.1.311: a project's own skills, in `.claude/skills` at the top of the worktree or in a folder below it, are not listed to a session that reads only the user's settings.
- Codex and the other agents are unchanged: what their lanes load from their own profiles is not checked here.

## Not tried with a real agent

Everything here is tested with stand-ins for `claude` and for `claude mcp list`. Since then real lanes on the
author's machine were given the `Skill` tool and called skills of the profile (2026-11-12, Claude Code 2.1.311).
Still not tried with a real agent: a lane that names a profile server, and what a server that needs a login
does in a headless session.
